import asyncio
import logging
import os
import socket
import threading
import time
from pathlib import Path
from typing import Optional

import paramiko
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

class SSHTunnel:
    """SSH Reverse Tunnel implementation using paramiko"""
    
    def __init__(self, 
                 private_server_port: int = None,
                 public_port: int = None,
                 ssh_user: str = None,
                 public_vps_ip: str = None,
                 ssh_password: str = None,
                 private_key_path: str = None,
                 passphrase: str = None):
        
        # Load from environment if not provided
        self.private_server_port = private_server_port or int(os.getenv('PRIVATE_SERVER_PORT', '9001'))
        self.public_port = public_port or int(os.getenv('PUBLIC_PORT', '9005'))
        self.ssh_user = ssh_user or os.getenv('SSH_USER', 'root')
        self.public_vps_ip = public_vps_ip or os.getenv('PUBLIC_VPS_IP')
        self.ssh_password = ssh_password or os.getenv('SSH_PASSWORD')
        self.private_key_path = private_key_path or os.getenv('SSH_PRIVATE_KEY_PATH')
        self.passphrase = passphrase or os.getenv('SSH_PASSPHRASE')
        
        self.ssh_client = None
        self.transport = None
        self.is_connected = False
        self.should_reconnect = True
        self.tunnel_thread = None
        
        if not self.public_vps_ip:
            raise ValueError("PUBLIC_VPS_IP is required but not provided")
    
    def _resolve_path(self, path: str) -> str:
        """Resolve paths like ~/.ssh/id_rsa to absolute paths"""
        if not path:
            return path
        if path.startswith('~/'):
            return str(Path.home() / path[2:])
        return str(Path(path).resolve())
    
    def _get_ssh_key(self) -> Optional[paramiko.PKey]:
        """Load SSH private key if available"""
        if not self.private_key_path:
            return None
        
        key_path = self._resolve_path(self.private_key_path)
        
        try:
            # Try different key types
            for key_class in [paramiko.RSAKey, paramiko.DSSKey, paramiko.ECDSAKey, paramiko.Ed25519Key]:
                try:
                    return key_class.from_private_key_file(key_path, password=self.passphrase)
                except paramiko.PasswordRequiredException:
                    logger.error(f"Private key {key_path} requires a passphrase")
                    return None
                except Exception:
                    continue
            
            logger.error(f"Unable to load private key from {key_path}")
            return None
            
        except Exception as e:
            logger.error(f"Error loading private key: {e}")
            return None
    
    def _handle_tunnel_connection(self, channel, origin, server):
        """Handle incoming connections through the tunnel"""
        try:
            logger.info(f"Incoming tunnel connection from {origin}")
            
            # Connect to local service
            local_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            local_socket.settimeout(10)
            
            try:
                local_socket.connect(('localhost', self.private_server_port))
                logger.info(f"Connected to local service on port {self.private_server_port}")
            except Exception as e:
                logger.error(f"Failed to connect to local service: {e}")
                channel.close()
                local_socket.close()
                return
            
            # Create bidirectional data forwarding
            def forward_data(source, destination, direction):
                try:
                    while True:
                        data = source.recv(4096)
                        if not data:
                            break
                        destination.send(data)
                except Exception as e:
                    logger.debug(f"Forwarding stopped ({direction}): {e}")
                finally:
                    try:
                        source.close()
                        destination.close()
                    except:
                        pass
            
            # Start forwarding threads
            thread1 = threading.Thread(
                target=forward_data, 
                args=(channel, local_socket, "tunnel->local"),
                daemon=True
            )
            thread2 = threading.Thread(
                target=forward_data, 
                args=(local_socket, channel, "local->tunnel"),
                daemon=True
            )
            
            thread1.start()
            thread2.start()
            
            # Wait for threads to complete
            thread1.join()
            thread2.join()
            
        except Exception as e:
            logger.error(f"Error handling tunnel connection: {e}")
        finally:
            try:
                channel.close()
                local_socket.close()
            except:
                pass
    
    def connect(self) -> bool:
        """Establish SSH connection and setup reverse tunnel"""
        try:
            logger.info(f"Connecting to {self.ssh_user}@{self.public_vps_ip}...")
            
            # Create SSH client
            self.ssh_client = paramiko.SSHClient()
            self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            # Prepare authentication
            connect_kwargs = {
                'hostname': self.public_vps_ip,
                'port': 22,
                'username': self.ssh_user,
                'timeout': 20,
                'allow_agent': False,
                'look_for_keys': False
            }
            
            # Try key authentication first
            ssh_key = self._get_ssh_key()
            if ssh_key:
                logger.info("Attempting SSH connection using private key")
                connect_kwargs['pkey'] = ssh_key
            elif self.ssh_password:
                logger.info("Attempting SSH connection using password")
                connect_kwargs['password'] = self.ssh_password
            else:
                logger.error("No authentication method provided")
                return False
            
            # Connect
            self.ssh_client.connect(**connect_kwargs)
            self.transport = self.ssh_client.get_transport()
            
            logger.info("SSH connection established")
            
            # Setup reverse tunnel
            try:
                self.transport.request_port_forward('', self.public_port, 
                                                  handler=self._handle_tunnel_connection)
                logger.info(f"Reverse tunnel established: {self.public_vps_ip}:{self.public_port} -> localhost:{self.private_server_port}")
                self.is_connected = True
                return True
                
            except Exception as e:
                logger.error(f"Failed to setup reverse tunnel: {e}")
                self.ssh_client.close()
                return False
                
        except paramiko.AuthenticationException:
            logger.error("SSH authentication failed")
        except paramiko.SSHException as e:
            logger.error(f"SSH connection error: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during SSH connection: {e}")
        
        return False
    
    def disconnect(self):
        """Close SSH connection"""
        self.should_reconnect = False
        self.is_connected = False
        
        if self.ssh_client:
            try:
                self.ssh_client.close()
            except:
                pass
            self.ssh_client = None
        
        logger.info("SSH tunnel disconnected")
    
    def start_tunnel(self):
        """Start SSH tunnel with auto-reconnect"""
        def tunnel_worker():
            while self.should_reconnect:
                try:
                    if not self.is_connected:
                        if self.connect():
                            # Keep connection alive
                            while self.is_connected and self.should_reconnect:
                                if self.transport and self.transport.is_active():
                                    time.sleep(10)  # Check every 10 seconds
                                else:
                                    logger.warning("SSH connection lost")
                                    self.is_connected = False
                                    break
                        else:
                            logger.info("Retrying SSH connection in 10 seconds...")
                            time.sleep(10)
                    else:
                        time.sleep(1)
                        
                except Exception as e:
                    logger.error(f"Tunnel worker error: {e}")
                    self.is_connected = False
                    time.sleep(10)
        
        self.tunnel_thread = threading.Thread(target=tunnel_worker, daemon=True)
        self.tunnel_thread.start()
        logger.info("SSH tunnel thread started")
    
    def stop_tunnel(self):
        """Stop SSH tunnel"""
        self.disconnect()
        if self.tunnel_thread and self.tunnel_thread.is_alive():
            self.tunnel_thread.join(timeout=5)


# Global tunnel instance
_tunnel_instance: Optional[SSHTunnel] = None

def create_ssh_tunnel(**kwargs) -> Optional[SSHTunnel]:
    """Create and start SSH tunnel"""
    global _tunnel_instance
    
    try:
        _tunnel_instance = SSHTunnel(**kwargs)
        _tunnel_instance.start_tunnel()
        return _tunnel_instance
    except Exception as e:
        logger.error(f"Failed to create SSH tunnel: {e}")
        return None

def get_tunnel_instance() -> Optional[SSHTunnel]:
    """Get the current tunnel instance"""
    return _tunnel_instance

def stop_ssh_tunnel():
    """Stop the SSH tunnel"""
    global _tunnel_instance
    if _tunnel_instance:
        _tunnel_instance.stop_tunnel()
        _tunnel_instance = None
