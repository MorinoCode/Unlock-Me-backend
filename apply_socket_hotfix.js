import fs from 'fs';

// 1. Edit server.js
let serverJs = fs.readFileSync('c:/unlock-me/Unlock-Me-backend/server.js', 'utf8');

const ioUseRegex = /io\.use\(\(socket, next\) => \{[\s\S]*?\}\);/;
const ioUseReplacement = `io.use((socket, next) => {
  try {
    let token = socket.handshake.auth?.token;
    if (!token && socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies["unlock-me-token"];
    }
    if (!token && socket.handshake.headers["authorization"]) {
      const authHeader = socket.handshake.headers["authorization"];
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }
    if (!token) return next(new Error("Authentication error"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded._id?.toString() || decoded.userId?.toString() || decoded.id?.toString();
    if (!socket.userId) return next(new Error("Authentication error"));
    next();
  } catch {
    return next(new Error("Authentication error"));
  }
});`;
serverJs = serverJs.replace(ioUseRegex, ioUseReplacement);

const ioOnRegex = /io\.on\("connection", \(socket\) => \{[\s\S]*?handleSocketConnection\(io, socket\);/;
const ioOnReplacement = `io.on("connection", (socket) => {
  try {
    if (socket.userId) {
      socket.join(socket.userId);
    }
    handleSocketConnection(io, socket);`;
serverJs = serverJs.replace(ioOnRegex, ioOnReplacement);

// 2. Edit socketHandler.js
let socketJs = fs.readFileSync('c:/unlock-me/Unlock-Me-backend/sockets/socketHandler.js', 'utf8');

const handlerStartRegex = /export const handleSocketConnection = \(io, socket\) => \{[\s\S]*?redisClient\.setEx\([^)]+\)\.catch\(\(\) => \{\}\);\n {2}\}/;
const handlerStartReplacement = `export const handleSocketConnection = (io, socket) => {
  const userId = socket.userId;
  if (userId) {
    redisClient.setEx(\`user:presence:\${userId}\`, 60, socket.id).catch(() => {});
  }`;
socketJs = socketJs.replace(handlerStartRegex, handlerStartReplacement);

const joinRoomRegex = /socket\.on\("join_room", \(userId\) => \{[\s\S]*?\}\);\n/g;
socketJs = socketJs.replace(joinRoomRegex, '');

// Remove Comments
const removeComments = (content) => {
  const noMulti = content.replace(/\/\*[\s\S]*?\*\//g, '');
  const noInline = noMulti.replace(/(?<![:"'])\/\/.*/g, '');
  return noInline.replace(/^\s*[\r\n]/gm, '');
};

serverJs = removeComments(serverJs);
socketJs = removeComments(socketJs);

fs.writeFileSync('c:/unlock-me/Unlock-Me-backend/server.js', serverJs);
fs.writeFileSync('c:/unlock-me/Unlock-Me-backend/sockets/socketHandler.js', socketJs);

const artifactPath = 'c:/Users/Mr.Morino/.gemini/antigravity/brain/2e7d1c33-cc46-4513-b107-efd758027273/socket_hotfix_report.md';
const reportMd = `# Socket Authentication Hotfix

## \`server.js\`
\`\`\`javascript
${serverJs}
\`\`\`

## \`sockets/socketHandler.js\`
\`\`\`javascript
${socketJs}
\`\`\`
`;

fs.writeFileSync(artifactPath, reportMd);
console.log('Hotfix applied successfully');
