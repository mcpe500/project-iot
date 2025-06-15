const { Client } = require('ssh2');
const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

/**
 * Resolves paths like ~/.ssh/id_rsa to absolute paths.
 * @param {string} inputPath Path potentially starting with ~
 * @returns {string} Absolute path
 */
function resolvePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
        return inputPath;
    }
    if (inputPath.startsWith('~' + path.sep)) {
        return path.join(os.homedir(), inputPath.slice(1));
    }
    return path.resolve(inputPath);
}

/**
 * Creates and maintains an SSH reverse tunnel
 * @param {number} privateServerPort Local server port (default: 3000)
 * @param {number} publicPort Public VPS port (default: 9001)
 * @param {string} sshUser SSH username
 * @param {string} publicVpsIp Public VPS IP
 * @param {string} sshPassword SSH password
 * @param {string} privateKeyPath SSH private key path
 * @param {string} passphrase Private key passphrase
 * @returns {Client|null} SSH client instance or null
 */
function createSshTunnel(
    privateServerPort = parseInt(process.env.PRIVATE_SERVER_PORT || '3000', 10),
    publicPort = parseInt(process.env.PUBLIC_PORT || '9001', 10),
    sshUser = process.env.SSH_USER || 'user',
    publicVpsIp = process.env.PUBLIC_VPS_IP,
    sshPassword = process.env.SSH_PASSWORD,
    privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH,
    passphrase = process.env.SSH_PASSPHRASE
) {
    console.log(`Creating SSH tunnel to ${sshUser}@${publicVpsIp}:${publicPort} (local port: ${privateServerPort})`);
    if (!publicVpsIp) {
        console.error('[Error] PUBLIC_VPS_IP is not defined');
        return null;
    }

    const resolvedKeyPath = privateKeyPath ? resolvePath(privateKeyPath) : undefined;    const authConfig = {
        host: publicVpsIp,
        port: 22,
        username: sshUser,
        readyTimeout: 30000,
        keepaliveInterval: 5000,  // More frequent keepalives
        keepaliveCountMax: 10,    // More retries before giving up
        // algorithms: {
        //     kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1'],
        //     cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr'],
        //     serverHostKey: ['ssh-rsa', 'ssh-dss'],
        //     hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1']
        // },
        forceIPv4: true,          // Force IPv4
        tryKeyboard: true,        // Try keyboard-interactive auth
        debug: console.log        // Enable debug logging
    };

    if (resolvedKeyPath) {
        try {
            authConfig.privateKey = fs.readFileSync(resolvedKeyPath);
            if (passphrase) authConfig.passphrase = passphrase;
        } catch (err) {
            console.error(`Failed to read private key: ${err.message}`);
            if (!sshPassword) return null;
            authConfig.password = sshPassword;
        }
    } else if (sshPassword) {
        authConfig.password = sshPassword;
    } else {
        console.error('No SSH credentials provided');
        return null;
    }    const conn = new Client();
    let retryTimeout = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 50; // Increase max attempts
    let isConnected = false;

    const connect = () => {
        if (retryTimeout) clearTimeout(retryTimeout);
        
        if (reconnectAttempts >= maxReconnectAttempts) {
            console.error(`Max reconnection attempts (${maxReconnectAttempts}) reached. Stopping.`);
            return;
        }
        
        reconnectAttempts++;
        console.log(`Connecting to ${sshUser}@${publicVpsIp}... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
        
        // Force close any existing connection
        if (conn._sock && !conn._sock.destroyed) {
            conn._sock.destroy();
        }
        
        conn.connect(authConfig);
    };    conn.on('ready', () => {
        console.log('SSH connection established');
        isConnected = true;
        reconnectAttempts = 0; // Reset retry counter on successful connection
        
        // Force kill any existing listeners on the remote port
        conn.exec(`pkill -f "0.0.0.0:${publicPort}" || true`, (err, stream) => {
            if (stream) {
                stream.on('close', () => {
                    // Now start the forward
                    startForward();
                });
            } else {
                startForward();
            }
        });
        
        function startForward() {
            conn.forwardIn('0.0.0.0', publicPort, (err, remotePort) => {
                if (err) {
                    console.error(`Failed to start remote listener: ${err}`);
                    // Force retry even if port binding fails
                    setTimeout(() => {
                        console.log('Forcing reconnection after port binding failure...');
                        conn.end();
                        setTimeout(connect, 2000);
                    }, 3000);
                    return;
                }
                console.log(`Remote server listening on port ${remotePort} - TUNNEL FORCED ACTIVE`);
                
                conn.on('tcp connection', (info, accept) => {
                    const sshStream = accept();
                    const localSocket = net.connect(privateServerPort, 'localhost', () => {
                        console.log(`Tunneling connection from ${info.srcIP}:${info.srcPort}`);
                        sshStream.pipe(localSocket).pipe(sshStream);
                    });

                    localSocket.on('error', (err) => {
                        console.error(`Local socket error: ${err.message}`);
                        sshStream.end();
                    });
                    sshStream.on('close', () => localSocket.end());
                    localSocket.on('close', () => sshStream.end());
                    sshStream.on('error', (err) => {
                        console.error(`SSH stream error: ${err.message}`);
                        localSocket.end();
                    });
                });
            });
        }
    });    conn.on('error', (err) => {
        console.error(`SSH error: ${err.message}`);
        isConnected = false;
        
        // Aggressive retry strategy
        const retryDelay = Math.min(5000 + (reconnectAttempts * 1000), 30000); // Exponential backoff, max 30s
        console.log(`Will retry in ${retryDelay}ms...`);
        retryTimeout = setTimeout(connect, retryDelay);
    });

    conn.on('close', (hadError) => {
        console.log(`Connection closed ${hadError ? 'with error' : ''}`);
        isConnected = false;
        
        // Always retry, even on clean close
        const retryDelay = hadError ? 2000 : 5000;
        console.log(`Forcing reconnection in ${retryDelay}ms...`);
        retryTimeout = setTimeout(connect, retryDelay);
    });

    // Force connection monitoring
    setInterval(() => {
        if (!isConnected && !retryTimeout) {
            console.log('Connection lost detected, forcing reconnection...');
            connect();
        }
    }, 10000); // Check every 10 seconds

    // Force immediate connection
    console.log('🚀 FORCING SSH TUNNEL CONNECTION...');
    connect();
    
    // Add process cleanup handlers
    process.on('SIGINT', () => {
        console.log('Received SIGINT, cleaning up SSH tunnel...');
        if (retryTimeout) clearTimeout(retryTimeout);
        conn.end();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('Received SIGTERM, cleaning up SSH tunnel...');
        if (retryTimeout) clearTimeout(retryTimeout);
        conn.end();
        process.exit(0);
    });

    // Return connection object with force methods
    conn.forceReconnect = () => {
        console.log('🔥 FORCING IMMEDIATE RECONNECTION...');
        if (retryTimeout) clearTimeout(retryTimeout);
        reconnectAttempts = 0;
        isConnected = false;
        if (conn._sock && !conn._sock.destroyed) {
            conn._sock.destroy();
        }
        setTimeout(connect, 1000);
    };

    conn.getStatus = () => ({
        connected: isConnected,
        attempts: reconnectAttempts,
        maxAttempts: maxReconnectAttempts
    });

    return conn;
}

module.exports = { createSshTunnel };