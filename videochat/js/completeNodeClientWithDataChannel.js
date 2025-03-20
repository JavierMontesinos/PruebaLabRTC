'use strict';

// Clean-up function:
// collect garbage before unloading browser's window
window.onbeforeunload = function(e){
  hangup();
}

// Data channel information
var sendChannel, receiveChannel;
var sendButton = document.getElementById("sendButton");
var sendTextarea = document.getElementById("dataChannelSend");
var receiveTextarea = document.getElementById("dataChannelReceive");

// HTML5 <video> elements
var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

// Handler associated with 'Send' button
sendButton.onclick = sendData;

// Flags...
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;

// WebRTC data structures
// Streams
var localStream;
var remoteStream;
// Peer Connection
var pc;

/*
var webrtcDetectedBrowser = null;
var webrtcDetectedVersion = null;

if (navigator.mozGetUserMedia) {
  console.log("This appears to be Firefox");
  webrtcDetectedBrowser = "firefox";
  webrtcDetectedVersion = parseInt(navigator.userAgent.match(/Firefox\/([0-9]+)\./)[1], 10);
}
else if (navigator.webkitGetUserMedia) {
  console.log("This appears to be Chrome");
  webrtcDetectedBrowser = "chrome";
  webrtcDetectedVersion = parseInt(navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)[2], 10);
else {
  console.log("This appears to be other Browser");
} */

/*
var pc_config = webrtcDetectedBrowser === 'firefox' ?
  // {'iceServers': [{'urls': 'stun:23.21.150.121'}]} :
  {'iceServers': [{'urls': 'stun:stun.services.mozilla.com'}]} :
  {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]
}; */

var pc_config = {
  'iceServers': [
    { 'urls': 'stun:stun.l.google.com:19302' },
    { 'urls': 'turn:your-turn-server.com', 'username': 'user', 'credential': 'pass' }
  ]
};
var pc_constraints = {
  'optional': [ {'DtlsSrtpKeyAgreement': true} ]
};

// Session Description Protocol constraints:
var sdpConstraints = {};

function trace(text) {
  // This function is used for logging.
  if (text[text.length - 1] == '\n') {
    text = text.substring(0, text.length - 1);
  }
  console.log((performance.now() / 1000).toFixed(3) + ": " + text);
}

/////////////////////////////////////////////
// Let's get started: prompt user for input (room name)
var room = prompt('Enter room name:');

var urlServer = location.origin;
console.log("socket.io client connecting to server ", urlServer );
// Connect to signalling server
var socket = io.connect(urlServer);

// Send 'Create or join' message to singnalling server
if (room !== '') {
  console.log('Create or join room', room);
  socket.emit('create or join', room);
}

// Set getUserMedia constraints
var constraints = {video: true, audio: true};

// From this point on, execution proceeds based on asynchronous events...

/////////////////////////////////////////////
// getUserMedia() handlers...
function handleUserMedia(stream) {
  source: localStream = stream;
  //attachMediaStream(localVideo, stream);
  localVideo.srcObject = stream;
  console.log('Adding local stream.');
  sendMessage('got user media');
}

function handleUserMediaError(error){
  console.log('navigator.getUserMedia error: ', error);
}
/////////////////////////////////////////////
// Server-mediated message exchanging...

/////////////////////////////////////////////
// 1. Server-->Client...

// Handle 'created' message coming back from server:
// this peer is the initiator
socket.on('created', function (room){
  console.log('Created room ' + room);
  isInitiator = true;

  // Call getUserMedia()
  navigator.mediaDevices.getUserMedia(constraints).then(handleUserMedia).catch(handleUserMediaError);
  console.log('Getting user media with constraints', constraints);

  checkAndStart();
});

// Handle 'full' message coming back from server:
// this peer arrived too late :-(
socket.on('full', function (room){
  console.log('Room ' + room + ' is full');
});

// Handle 'join' message coming back from server:
// another peer is joining the channel
socket.on('join', function (room){
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  isChannelReady = true;
});

// Handle 'joined' message coming back from server:
// this is the second peer joining the channel
socket.on('joined', function (room){
  console.log('This peer has joined room ' + room);
  isChannelReady = true;

  // Call getUserMedia()
  navigator.mediaDevices.getUserMedia(constraints).then(handleUserMedia).catch(handleUserMediaError);
  console.log('Getting user media with constraints', constraints);
});

// Server-sent log message...
socket.on('log', function (array){
  console.log.apply(console, array);
});

// Receive message from the other peer via the signalling server
socket.on('message', function (message){
  console.log('Received message:', message);
  if (message.message === 'got user media') {
    checkAndStart();
  } else if (message.message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      checkAndStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message.message));
    doAnswer();
  } else if (message.message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message.message));
  } else if (message.message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({sdpMLineIndex:message.message.label,
      candidate:message.message.candidate});
    pc.addIceCandidate(candidate);
  } else if (message.message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});
////////////////////////////////////////////////
// 2. Client-->Server

// Send message to the other peer via the signalling server
function sendMessage(message){
  console.log('Sending message: ', message);
  socket.emit('message', {
              channel: room,
              message: message});
}

////////////////////////////////////////////////////
// Channel negotiation trigger function
function checkAndStart() {
  if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {
    createPeerConnection();
    isStarted = true;
    if (isInitiator) {
      doCall();
    }
  }
}

/////////////////////////////////////////////////////////
// Peer Connection management...
function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(pc_config, pc_constraints);

    console.log("Adding tracks from localStream to RTCPeerConnection.");
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.onicecandidate = handleIceCandidate;
    console.log('Created RTCPeerConnection with:\n' +
      '  config: \'' + JSON.stringify(pc_config) + '\';\n' +
      '  constraints: \'' + JSON.stringify(pc_constraints) + '\'.');
  } catch (e) {
    console.error('Failed to create PeerConnection, exception:', e); // Log full error
    alert('Cannot create RTCPeerConnection object. Error: ' + e.message);
    return;
  }

  pc.ontrack = handleRemoteStreamAdded;
  pc.onremovestream = handleRemoteStreamRemoved;

  if (isInitiator) {
    try {
      sendChannel = pc.createDataChannel("sendDataChannel", { reliable: true });
      trace('Created send data channel');
    } catch (e) {
      console.error('Failed to create data channel:', e); // Log full error
      alert('Failed to create data channel. Error: ' + e.message);
    }
    sendChannel.onopen = handleSendChannelStateChange;
    sendChannel.onmessage = handleMessage;
    sendChannel.onclose = handleSendChannelStateChange;
  } else {
    pc.ondatachannel = gotReceiveChannel;
  }
}

// Data channel management
function sendData() {
  var data = sendTextarea.value;
  receiveTextarea.value += 'You: ' + sendTextarea.value + '\n';
  sendTextarea.value = '';
  receiveTextarea.scrollTop = receiveTextarea.scrollHeight;
  if(isInitiator) sendChannel.send(data);
  else receiveChannel.send(data);
  trace('Sent data: ' + data);
}

// Handlers...

function gotReceiveChannel(event) {
  trace('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = handleMessage;
  receiveChannel.onopen = handleReceiveChannelStateChange;
  receiveChannel.onclose = handleReceiveChannelStateChange;
}

function handleMessage(event) {
  trace('Received message: ' + event.data);
  receiveTextarea.value +='Remote: ' + event.data + '\n';
  receiveTextarea.scrollTop = receiveTextarea.scrollHeight;
}

function handleSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  console.log('Send channel state is: ' + readyState);
  if (readyState === "open") {
    console.log('Enabling dataChannelSend');
    const dataChannelSend = document.getElementById('dataChannelSend');
    const sendButton = document.getElementById('sendButton');
    dataChannelSend.disabled = false;
    dataChannelSend.focus();
    dataChannelSend.placeholder = "Type your message here...";
    sendButton.disabled = false;
  } else {
    console.log('Disabling dataChannelSend');
    const dataChannelSend = document.getElementById('dataChannelSend');
    const sendButton = document.getElementById('sendButton');
    dataChannelSend.disabled = true;
    sendButton.disabled = true;
  }
}

function handleReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  console.log('Receive channel state is: ' + readyState);
  if (readyState === "open") {
    console.log('Enabling dataChannelSend');
    const dataChannelSend = document.getElementById('dataChannelSend');
    const sendButton = document.getElementById('sendButton');
    dataChannelSend.disabled = false;
    dataChannelSend.focus();
    dataChannelSend.placeholder = "Type your message here...";
    sendButton.disabled = false;
  } else {
    console.log('Disabling dataChannelSend');
    const dataChannelSend = document.getElementById('dataChannelSend');
    const sendButton = document.getElementById('sendButton');
    dataChannelSend.disabled = true;
    sendButton.disabled = true;
  }
}

function handleReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  console.log('Receive channel state is: ' + readyState);
  if (readyState === "open") {
    console.log('Enabling dataChannelSend');
    const dataChannelSend = document.getElementById('dataChannelSend');
    const sendButton = document.getElementById('sendButton');
    dataChannelSend.disabled = false;
    dataChannelSend.focus();
    dataChannelSend.placeholder = "Type your message here...";
    sendButton.disabled = false;
  } else {
    console.log('Disabling dataChannelSend');
    const dataChannelSend = document.getElementById('dataChannelSend');
    const sendButton = document.getElementById('sendButton');
    dataChannelSend.disabled = true;
    sendButton.disabled = true;
  }
}

// ICE candidates management
function handleIceCandidate(event) {
  console.log('handleIceCandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate});
  } else {
    console.log('End of candidates.');
  }
}

// Create Offer
function doCall() {
  console.log('Creating Offer...');
  pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

// Signalling error handler
function onSignalingError(error) {
	console.log('Failed to create signaling message : ' + error.name);
}

// Create Answer
function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
}

// Success handler for both createOffer()
// and createAnswer()
function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}

/////////////////////////////////////////////////////////
// Remote stream handlers...

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');

  if (event.streams && event.streams[0]) {
    const remoteStreamId = event.streams[0].id; // Identificar el flujo remoto por su ID
    const remoteVideosContainer = document.getElementById('remoteVideosContainer');

    // Verificar si ya existe un video para este flujo remoto
    const existingVideo = document.querySelector(`video[data-stream-id="${remoteStreamId}"]`);
    if (existingVideo) {
      console.log('Remote stream already added, skipping.');
      return; // Salir si el flujo ya está agregado
    }

    // Crear un nuevo elemento <video> para este flujo remoto
    const remoteVideoElement = document.createElement('video');
    remoteVideoElement.autoplay = true;
    remoteVideoElement.playsInline = true;
    remoteVideoElement.srcObject = event.streams[0];
    //remoteVideoElement.style.width = '200px'; // Ajusta el tamaño según sea necesario
    remoteVideoElement.setAttribute('data-stream-id', remoteStreamId); // Asignar un atributo único para identificar el flujo

    // Agregar el nuevo elemento <video> al contenedor
    remoteVideosContainer.appendChild(remoteVideoElement);

    console.log('Remote stream attached to new video element.');
  } else {
    console.error('No remote stream found in event.');
  }
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}
/////////////////////////////////////////////////////////
// Clean-up functions...

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

function stop() {
  isStarted = false;
  if (sendChannel) sendChannel.close();
  if (receiveChannel) receiveChannel.close();
  if (pc) pc.close();
  pc = null;
  sendButton.disabled=true;
}

///////////////////////////////////////////
