const { spawn, execSync } = require('child_process');
const net = require('net');
require('dotenv').config();

const {
  BASTION_HOST,
  BASTION_USER,
  BASTION_KEY_PATH,
  AURORA_HOST,
  AURORA_PORT,
  LOCAL_FORWARD_PORT
} = process.env;

// The command you want to run (e.g., 'node index.js' or 'npx prisma studio')
const commandToRun = process.argv.slice(2).join(' ');

if (!commandToRun) {
  console.error("Provide a command to run. Example: node run-tunneled.js node index.js");
  process.exit(1);
}

console.log(`Establishing SSH tunnel to ${AURORA_HOST} via ${BASTION_HOST}...`);

const sshTunnel = spawn('ssh', [
  '-N', // Do not execute a remote command
  '-L', `${LOCAL_FORWARD_PORT}:${AURORA_HOST}:${AURORA_PORT}`,
  '-i', BASTION_KEY_PATH,
  `${BASTION_USER}@${BASTION_HOST}`
]);

sshTunnel.stderr.on('data', (data) => {
  // SSH diagnostic output goes to stderr
  if (data.toString().includes('Address already in use')) {
    console.error(`Port ${LOCAL_FORWARD_PORT} is already in use.`);
    process.exit(1);
  }
});

// Function to check if the local port is open
const checkTunnelReady = () => {
  const socket = new net.Socket();
  socket.setTimeout(1000);
  
  socket.on('connect', () => {
    socket.destroy();
    console.log(`Tunnel established on port ${LOCAL_FORWARD_PORT}. Running command: ${commandToRun}`);
    
    // Execute the user's command
    // Note: We use DATABASE_URL_AURORA as the standard DATABASE_URL for this execution context
    const childEnv = { 
      ...process.env, 
      DATABASE_URL: process.env.DATABASE_URL_AURORA 
    };

    const child = spawn(commandToRun, {
      shell: true,
      stdio: 'inherit',
      env: childEnv
    });

    child.on('exit', (code) => {
      console.log(`Process exited with code ${code}. Closing tunnel.`);
      sshTunnel.kill();
      process.exit(code);
    });
  }).on('error', () => {
    // Retry if not ready yet
    setTimeout(checkTunnelReady, 500);
  });

  socket.connect(LOCAL_FORWARD_PORT, '127.0.0.1');
};

// Start checking if tunnel is ready
setTimeout(checkTunnelReady, 1000);

// Cleanup on exit
process.on('SIGINT', () => {
  sshTunnel.kill();
  process.exit();
});
