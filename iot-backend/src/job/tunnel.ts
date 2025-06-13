import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';
import { EventEmitter } from 'events';

// Load environment variables from .env file
dotenv.config();

// Extend SSH2.Client to include missing events
declare module 'ssh2' {
    interface Client {
        on(event: 'ready', listener: () => void): this;
        on(event: 'tcp connection', listener: (info: any, accept: () => ClientChannel, reject: () => void) => void): this;
        on(event: 'error', listener: (err: Error) => void): this;
        on(event: 'close', listener: (hadError: boolean) => void): this;
        on(event: 'end', listener: () => void): this;
    }
}

/**
 * Resolves paths like ~/.ssh/id_rsa to absolute paths.
 * @param inputPath Path potentially starting with ~
 * @returns Absolute path
 */
function resolvePath(inputPath: string): string {
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
 * @param privateServerPort - Port where your local server is running (default: from env or 3000)
 * @param publicPort - Port on the public VPS to listen on (default: from env or 9001)
 * @param sshUser - SSH user for the public VPS (default: from env or 'user')
 * @param publicVpsIp - IP address of the public VPS (required, from env)
 * @param sshPassword - SSH password (optional, from env)
 * @param privateKeyPath - Path to the SSH private key (optional, from env)
 * @param passphrase - Passphrase for the private key (optional, from env)
 * @returns The ssh2 Client instance if successful, otherwise null.
 */
export function createSshTunnel(
    privateServerPort: number = parseInt(process.env.PRIVATE_SERVER_PORT || '3000', 10),
    publicPort: number = parseInt(process.env.PUBLIC_PORT || '9001', 10),
    sshUser: string = process.env.SSH_USER || 'user',
    publicVpsIp: string | undefined = process.env.PUBLIC_VPS_IP,
    sshPassword: string | undefined = process.env.SSH_PASSWORD,
    privateKeyPath: string | undefined = process.env.SSH_PRIVATE_KEY_PATH,
    passphrase: string | undefined = process.env.SSH_PASSPHRASE
): Client | null {

    if (!publicVpsIp) {
        console.error('[Error] PUBLIC_VPS_IP is not defined in environment variables or passed as argument.');
        return null;
    }

    const resolvedKeyPath = privateKeyPath ? resolvePath(privateKeyPath) : undefined;

    // --- Authentication Configuration ---
    const authConfig: ConnectConfig = {
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
        } catch (err: any) {
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
    let retryTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
        if (retryTimeout) clearTimeout(retryTimeout);
        console.log(`[Info] Connecting to ${sshUser}@${publicVpsIp}...`);
        conn.connect(authConfig);
    };

    conn.on('ready', () => {
        console.log('[Success] SSH connection established.');

        // --- Setup Reverse Tunnel (Remote Forwarding -R) ---
        // Ask the remote server to listen on publicPort
        conn.forwardIn('0.0.0.0', publicPort, (err: Error | undefined, remotePort: number) => {
            if (err) {
                console.error(`[Error] Failed to start remote listener on port ${publicPort}:`, err);
                conn.end(); // Close connection if forwarding fails
                return;
            }
            console.log(`[Success] Remote server listening on port ${remotePort} (requested ${publicPort})`);

            // --- Handle Incoming Connections from the Tunnel ---
            conn.on('tcp connection', (info: any, accept: () => ClientChannel, reject: () => void) => {
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

                localSocket.on('error', (socketErr: Error) => {
                    console.error(`[Error] Local socket connection error (port ${privateServerPort}):`, socketErr.message);
                    try {
                        reject(); // Reject the SSH forwarded connection
                    } catch (rejectErr: any) {
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

                sshStream.on('error', (streamErr: Error) => {
                    console.error('[Error] SSH stream error:', streamErr.message);
                    localSocket.end(); // Ensure local socket is closed on stream error
                });
            });
        });
    });

    conn.on('error', (err: Error) => {
        console.error(`[Error] SSH connection error: ${err.message}`);
        // Optional: Implement retry logic here
        console.log('[Info] Attempting to reconnect in 10 seconds...');
        retryTimeout = setTimeout(connect, 10000); // Retry after 10 seconds
    });

    conn.on('close', (hadError: boolean) => {
        console.log(`[Info] SSH connection closed${hadError ? ' due to an error' : ''}.`);
        // Optional: Implement retry logic or cleanup
        if (!hadError) {
            // If closed intentionally or without error, maybe retry
            console.log('[Info] Attempting to reconnect in 10 seconds...');
            retryTimeout = setTimeout(connect, 10000); // Retry after 10 seconds
        }
        // If hadError, the 'error' event likely already triggered the retry
    });

    // Initial connection attempt
    connect();

    return conn; // Return the client instance
}

// --- Example Usage ---
// If executing this file directly (e.g., `ts-node ssh-tunnel.ts` or `node dist/ssh-tunnel.js`)
if (require.main === module) {
    const sshClient = createSshTunnel();

    if (sshClient) {
        console.log('SSH tunnel setup initiated. Keep this process running. Press Ctrl+C to exit.');

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n[Info] SIGINT received, closing SSH tunnel...');
            if (sshClient) {
                sshClient.end();
            }
            process.exit(0);
        });
        process.on('SIGTERM', () => {
            console.log('\n[Info] SIGTERM received, closing SSH tunnel...');
            if (sshClient) {
                sshClient.end();
            }
            process.exit(0);
        });

    } else {
        console.error('[Fatal] Failed to initiate SSH tunnel setup.');
        process.exit(1);
    }
}