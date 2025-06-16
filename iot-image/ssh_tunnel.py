# ssh_tunnel.py
import logging
import os
import socket
import threading
import time
from pathlib import Path
from typing import Optional

import paramiko

logger = logging.getLogger(__name__)

class SSHTunnel:
    """SSH Reverse Tunnel implementation using paramiko"""
    
    def __init__(self,
                 public_vps_ip: str,
                 ssh_server_port: int,
                 ssh_user: str,
                 public_port: int,
                 private_server_port: int,
                 ssh_password: str = None,
                 private_key_path: str = None,
                 passphrase: str = None):
        
        self.public_vps_ip = public_vps_ip
        self.ssh_server_port = ssh_server_port
        self.ssh_user = ssh_user
        self.ssh_password = ssh_password
        self.private_key_path = private_key_path or os.getenv('SSH_PRIVATE_KEY_PATH')
        self.passphrase = passphrase or os.getenv('SSH_PASSPHRASE')
        
        self.public_port = public_port
        self.private_server_port = private_server_port
        
        self.ssh_client = None
        self.transport = None
        self.is_active = False
        self.should_reconnect = True
        self.tunnel_thread = None
        
        if not self.public_vps_ip:
            raise ValueError("PUBLIC_VPS_IP is required")
    
    def _resolve_path(self, path: str) -> str:
        if not path: return path
        return str(Path(path).expanduser().resolve())
    
    def _get_ssh_key(self) -> Optional[paramiko.PKey]:
        if not self.private_key_path: return None
        key_path = self._resolve_path(self.private_key_path)
        try:
            for key_class in [paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.DSSKey]:
                try:
                    return key_class.from_private_key_file(key_path, password=self.passphrase)
                except Exception:
                    continue
            logger.error(f"Unable to load private key from {key_path}")
            return None
        except Exception as e:
            logger.error(f"Error loading private key: {e}")
            return None

    def _handle_tunnel_connection(self, channel, origin, server):
        try:
            local_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            local_socket.connect(('127.0.0.1', self.private_server_port))

            def forward(src, dest, direction):
                while True:
                    data = src.recv(1024)
                    if not data: break
                    dest.sendall(data)
                src.close()
                dest.close()

            threading.Thread(target=forward, args=(channel, local_socket, "fwd"), daemon=True).start()
            threading.Thread(target=forward, args=(local_socket, channel, "rev"), daemon=True).start()
        except Exception as e:
            logger.error(f"Error handling tunnel connection from {origin}: {e}")
            channel.close()

    def connect(self) -> bool:
        try:
            logger.info(f"Connecting to {self.ssh_user}@{self.public_vps_ip}:{self.ssh_server_port}...")
            self.ssh_client = paramiko.SSHClient()
            self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            connect_kwargs = {
                'hostname': self.public_vps_ip,
                'port': self.ssh_server_port,
                'username': self.ssh_user,
                'timeout': 20,
                'allow_agent': False,
                'look_for_keys': False
            }
            
            ssh_key = self._get_ssh_key()
            if ssh_key:
                logger.info("Attempting SSH connection using private key.")
                connect_kwargs['pkey'] = ssh_key
            elif self.ssh_password:
                logger.info("Attempting SSH connection using password.")
                connect_kwargs['password'] = self.ssh_password
            else:
                logger.error("No SSH authentication method available (password or private key).")
                return False

            self.ssh_client.connect(**connect_kwargs)
            self.transport = self.ssh_client.get_transport()
            self.transport.set_keepalive(60)
            
            logger.info("SSH connection established. Setting up reverse tunnel...")
            self.transport.request_port_forward('', self.public_port, handler=self._handle_tunnel_connection)
            
            logger.info(f"Reverse tunnel established: {self.public_vps_ip}:{self.public_port} -> localhost:{self.private_server_port}")
            self.is_active = True
            return True
            
        except Exception as e:
            logger.error(f"Failed to establish SSH connection or tunnel: {e}", exc_info=True)
            self.is_active = False
            if self.ssh_client: self.ssh_client.close()
            return False

    def disconnect(self):
        self.should_reconnect = False
        self.is_active = False
        if self.transport and self.transport.is_active():
            self.transport.cancel_port_forward('', self.public_port)
        if self.ssh_client:
            self.ssh_client.close()
        logger.info("SSH tunnel disconnected.")
    
    def start(self):
        def tunnel_worker():
            while self.should_reconnect:
                if not (self.transport and self.transport.is_active()):
                    self.is_active = False
                    logger.info("Tunnel is down, attempting to reconnect...")
                    self.connect()
                time.sleep(15) # Check connection status every 15 seconds
        
        self.tunnel_thread = threading.Thread(target=tunnel_worker, daemon=True)
        self.tunnel_thread.start()
        logger.info("SSH tunnel monitor thread started.")
    
    def stop(self):
        self.disconnect()
        if self.tunnel_thread and self.tunnel_thread.is_alive():
            self.tunnel_thread.join(timeout=5)

# --- Global Singleton Management ---
_tunnel_instance: Optional[SSHTunnel] = None

def create_ssh_tunnel(**kwargs) -> Optional[SSHTunnel]:
    global _tunnel_instance
    if _tunnel_instance:
        logger.warning("SSH tunnel already exists.")
        return _tunnel_instance
    try:
        _tunnel_instance = SSHTunnel(**kwargs)
        _tunnel_instance.start()
        return _tunnel_instance
    except Exception as e:
        logger.error(f"Failed to create SSH tunnel: {e}")
        return None

def get_tunnel_instance() -> Optional[SSHTunnel]:
    return _tunnel_instance

def stop_ssh_tunnel():
    global _tunnel_instance
    if _tunnel_instance:
        _tunnel_instance.stop()
        _tunnel_instance = None
