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
    if (!publicVpsIp) {
        console.error('[Error] PUBLIC_VPS_IP is not defined');
        return null;
    }

    const resolvedKeyPath = privateKeyPath ? resolvePath(privateKeyPath) : undefined;
    const authConfig = {
        host: publicVpsIp,
        port: 22,
        username: sshUser,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 5,
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
    }

    const conn = new Client();
    let retryTimeout = null;

    const connect = () => {
        if (retryTimeout) clearTimeout(retryTimeout);
        console.log(`Connecting to ${sshUser}@${publicVpsIp}...`);
        conn.connect(authConfig);
    };

    conn.on('ready', () => {
        console.log('SSH connection established');
        conn.forwardIn('0.0.0.0', publicPort, (err, remotePort) => {
            if (err) {
                console.error(`Failed to start remote listener: ${err}`);
                conn.end();
                return;
            }
            console.log(`Remote server listening on port ${remotePort}`);
            
            conn.on('tcp connection', (info, accept) => {
                const sshStream = accept();
                const localSocket = net.connect(privateServerPort, 'localhost', () => {
                    sshStream.pipe(localSocket).pipe(sshStream);
                });

                localSocket.on('error', () => sshStream.end());
                sshStream.on('close', () => localSocket.end());
                localSocket.on('close', () => sshStream.end());
                sshStream.on('error', () => localSocket.end());
            });
        });
    });

    conn.on('error', (err) => {
        console.error(`SSH error: ${err.message}`);
        retryTimeout = setTimeout(connect, 10000);
    });

    conn.on('close', (hadError) => {
        console.log(`Connection closed ${hadError ? 'with error' : ''}`);
        if (!hadError) retryTimeout = setTimeout(connect, 10000);
    });

    connect();
    return conn;
}

module.exports = { createSshTunnel };