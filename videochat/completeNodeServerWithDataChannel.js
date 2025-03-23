var static = require('node-static');

var https = require('https');

// Change directory to path of current JavaScript program
// var process = require('process');
// process.chdir(__dirname);
//descomentar las dos l�neas anteriores si no se quiere poner el subdirectorio al final, por ej. https://...:8080/cap5/

// Read key and certificates required for https
var fs = require('fs');
var path = require('path');

var options = {
  key: fs.readFileSync(path.join(__dirname,'key.pem')),
  //key: fs.readFileSync(path.join(__dirname,'key.pem')),
  cert: fs.readFileSync(path.join(__dirname,'cert.pem'))
};
// Create a node-static server instance
var file = new(static.Server)();

// We use the http module�s createServer function and
// rely on our instance of node-static to serve the files
var app = https.createServer(options, function (req, res) {
  file.serve(req, res);
}).listen(8080);

// Use socket.io JavaScript library for real-time web applications
var io = require('socket.io')(app);

// Let's start managing connections...
const MAX_CLIENTS = 10; // Número máximo de usuarios por sala

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('create or join', (room) => {
    const clientsInRoom = io.sockets.adapter.rooms.get(room) || new Set();
    const numClients = clientsInRoom.size;

    console.log(`Room ${room} has ${numClients} client(s)`);

    if (numClients === 0) {
      socket.join(room);
      console.log(`Client ID ${socket.id} created room ${room}`);
      socket.emit('created', room);
    } else if (numClients < MAX_CLIENTS) {
      socket.join(room);
      console.log(`Client ID ${socket.id} joined room ${room}`);
      socket.emit('joined', room);
      socket.to(room).emit('join', room);
    } else {
      socket.emit('full', room);
      console.log(`Room ${room} is full`);
    }
  });

  socket.on('message', (message) => {
    console.log('Received message:', message);
    const room = message.channel;
    socket.to(room).emit('message', message);
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });

  // socket.on('message', function (message) { // Handle 'message' messages
  //   console.log('S --> got message: ', message);
  //   // channel-only broadcast...
  //   socket.broadcast.to(message.channel).emit('message', message);
  // });

  function log(){
    var array = [">>> "];
    for (var i = 0; i < arguments.length; i++) {
      array.push(arguments[i]);
    }
    socket.emit('log', array);
  }

});
