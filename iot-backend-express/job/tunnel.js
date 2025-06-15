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
 * @param {string} inputPath - Path potentially starting with ~
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
 * Creates and maintains an SSH reverse tunnel using the ssh2 library.
 * @param {number} [privateServerPort=3000] - Port where your local server is running (default: from env or 3000).
 * @param {number} [publicPort=9001] - Port on the public VPS to listen on (default: from env or 9001).
 * @param {string} [sshUser='user'] - SSH user for the public VPS (default: from env or 'user').
 * @param {string} [publicVpsIp] - IP address of the public VPS (required, from env).
 * @param {string} [sshPassword] - SSH password (optional, from env).
 * @param {string} [privateKeyPath] - Path to the SSH private key (optional, from env).
 * @param {string} [passphrase] - Passphrase for the private key (optional, from env).
 * @returns {import('ssh2').Client | null} The ssh2 Client instance if successful, otherwise null.
 */
exports.createSshTunnel = function createSshTunnel(
    privateServerPort = parseInt(process.env.PRIVATE_SERVER_PORT || '3000', 10),
    publicPort = parseInt(process.env.PUBLIC_PORT || '9001', 10),
    sshUser = process.env.SSH_USER || 'user',
    publicVpsIp = process.env.PUBLIC_VPS_IP,
    sshPassword = process.env.SSH_PASSWORD,
    privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH,
    passphrase = process.env.SSH_PASSPHRASE
) {

    if (!publicVpsIp) {
        console.error('[Error] PUBLIC_VPS_IP is not defined in environment variables or passed as argument.');
        return null;
    }

    const resolvedKeyPath = privateKeyPath ? resolvePath(privateKeyPath) : undefined;

    // --- Authentication Configuration ---
    const authConfig = {
        host: publicVpsIp,
        port: 22, // Default SSH port
        username: sshUser,
        readyTimeout: 20000, // Increase timeout for potentially slower connections
        keepaliveInterval: 15000, // Send keepalive every 15 seconds
        keepaliveCountMax: 5, // Disconnect after 5 missed keepalives
    };

    if (resolvedKeyPath) {
        try {
            console.log(`[Info] Attempting SSH connection using key: ${resolvedKeyPath}`);
            authConfig.privateKey = fs.readFileSync(resolvedKeyPath);
            if (passphrase) {
                authConfig.passphrase = passphrase;
            }
        } catch (err) {
            console.error(`[Error] Failed to read private key file "${resolvedKeyPath}": ${err.message}`);
            // Optionally fall back to password or just fail
            if (!sshPassword) {
                console.error('[Error] No password provided as fallback.');
                return null;
            }
            console.warn('[Warn] Falling back to password authentication.');
            authConfig.password = sshPassword;
        }
    } else if (sshPassword) {
        console.log(`[Info] Attempting SSH connection using password for user ${sshUser}`);
        authConfig.password = sshPassword;
    } else {
        console.error('[Error] No SSH password or private key path provided.');
        return null;
    }

    // --- SSH Client Setup ---
    const conn = new Client();
    let retryTimeout = null;

    const connect = () => {
        if (retryTimeout) clearTimeout(retryTimeout);
        console.log(`[Info] Connecting to ${sshUser}@${publicVpsIp}...`);
        conn.connect(authConfig);
    };

    conn.on('ready', () => {
        console.log('[Success] SSH connection established.');

        // --- Setup Reverse Tunnel (Remote Forwarding -R) ---
        // Ask the remote server to listen on publicPort
        conn.forwardIn('0.0.0.0', publicPort, (err, remotePort) => {
            if (err) {
                console.error(`[Error] Failed to start remote listener on port ${publicPort}:`, err);
                conn.end(); // Close connection if forwarding fails
                return;
            }
            console.log(`[Success] Remote server listening on port ${remotePort} (requested ${publicPort})`);

            // --- Handle Incoming Connections from the Tunnel ---
            conn.on('tcp connection', (info, accept, reject) => {
                console.log(`[Info] Incoming tunnel connection from ${info.srcIP}:${info.srcPort} to ${info.destIP}:${info.destPort}`);

                const sshStream = accept(); // Accept the connection from the remote side

                // Connect to the local private server
                console.log(`[Info] Attempting to connect to local service at localhost:${privateServerPort}...`);

                const localSocket = net.connect(privateServerPort, 'localhost', () => {
                    console.log(`[Success] Connected to local service on port ${privateServerPort}`);
                    // Bridge the connections: Pipe data back and forth
                    sshStream.pipe(localSocket).pipe(sshStream);
                    console.log(`[Info] Data pipe established between remote client and local service`);
                });

                localSocket.on('error', (socketErr) => {
                    console.error(`[Error] Local socket connection error (port ${privateServerPort}):`, socketErr.message);
                    try {
                        reject(); // Reject the SSH forwarded connection
                    } catch (rejectErr) {
                        console.error('[Error] Failed to reject SSH connection:', rejectErr.message);
                    }
                });

                sshStream.on('close', () => {
                    // console.log('[Info] SSH stream closed, closing local socket.');
                    localSocket.end();
                });

                localSocket.on('close', (hadError) => {
                    // console.log(`[Info] Local socket closed (hadError: ${hadError}), closing SSH stream.`);
                    sshStream.end();
                });

                sshStream.on('error', (streamErr) => {
                    console.error('[Error] SSH stream error:', streamErr.message);
                    localSocket.end(); // Ensure local socket is closed on stream error
                });
            });
        });
    });

    conn.on('error', (err) => {
        console.error(`[Error] SSH connection error: ${err.message}`);
        // Optional: Implement retry logic here
        console.log('[Info] Attempting to reconnect in 10 seconds...');
        retryTimeout = setTimeout(connect, 10000); // Retry after 10 seconds
    });

    conn.on('close', (hadError) => {
        console.log(`[Info] SSH connection closed${hadError ? ' due to an error' : ''}.`);
        // If not closed by an error, it might be an intentional close or a network drop.
        // The current logic retries on any close, which is generally desirable for a persistent tunnel.
        console.log('[Info] Attempting to reconnect in 10 seconds...');
        retryTimeout = setTimeout(connect, 10000); // Retry after 10 seconds
    });

    // Initial connection attempt
    connect();

    return conn; // Return the client instance
}

// --- Example Usage ---
// If executing this file directly (e.g., `node ssh-tunnel.js`)
if (require.main === module) {
    const sshClient = exports.createSshTunnel();

    if (sshClient) {
        console.log('SSH tunnel setup initiated. Keep this process running. Press Ctrl+C to exit.');

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n[Info] SIGINT received, closing SSH tunnel...');
            if (sshClient) {
                // Remove all listeners to prevent reconnection attempts during shutdown
                sshClient.removeAllListeners();
                sshClient.end();
            }
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            console.log('\n[Info] SIGTERM received, closing SSH tunnel...');
            if (sshClient) {
                sshClient.removeAllListeners();
                sshClient.end();
            }
            process.exit(0);
        });

    } else {
        console.error('[Fatal] Failed to initiate SSH tunnel setup.');
        process.exit(1);
    }
}