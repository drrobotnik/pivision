// THESE DEPENDENCIES COME DEFAULT WITH NODE
var http = require('http'),
    util = require('util'),
    fs = require('fs');

// THESE DEPENDENCIES NEED TO BE INSTALLED EXPLICITLY
// THROUGH NPM ( "npm install express --save") AND WILL 
// BE REGISTERED IN OUR PACKAGE.JSON 

// 'EXPRESS' GIVES US A BASIC HOSTING FRAMEWORK
var express = require('express');

// 'SOCKET.IO' ALLOWS US TO RECEIVE STREAMED DATA FROM
// THE CLIENT FOR ADDITIONAL PROCESSING AS WELL AS REPLY BACK
var socket = require('socket.io');

// 'REQUEST'' ALLOWS US TO CALL OUT TO THE 
// COGNITIVE SERVICES REST APIS TO PROCESS THE POSTED DATA
var request = require('request');


// **********************************************************************************
// ACCESS KEYS 
// ----------------------------------------------------------------------------------
// NOTE: THESE SHOULD BE MOVED TO A CONFIGURATION FILE AND NEVER SHARED.
// LISTED HERE SO YOU KNOW WHERE TO ENTER YOUR OWN VALUES AND BE MORE READABLE
// FOR THE TUTORIAL. REPLACE 'xxx-xxx-xxx...' WITH YOUR OWN VALUES ONCE 
// YOU'VE SETUP YOUR ACCOUNTS
// **********************************************************************************

// THIS IS A SHARED, GLOBALLY PUBLIC APP ID TO GET 
// THE 'SPEECH TO TEXT' RESULTS BACK. WORKS FOR EVERYONE
var speechToTextRequiredAppID = 'D4D52672-91D7-4C74-8AD8-42B1D98141A5';

// THE REST WILL REQUIRE A PRIVATE, PERSONAL KEY FROM THE COG SERVICES / AZURE ACCOUNTS:
// ONCE YOU HAVE SIGNED UP FOR MICROSOFT COGNITIVE SERVICES, 
// WE CAN ACCESS MOST OF YOUR KEYS HERE:
// https://www.microsoft.com/cognitive-services/en-US/subscriptions

// FOUND UNDER 'Computer Vision - Preview'
var visionKey = 'YOUR_VISION_KEY_HERE';

// FOUND UNDER 'EMOTION - PREVIEW'
var emotionKey = 'YOUR_EMOTION_KEY_HERE';

// THESE OTHER TWO API KEYS ARE FOR THE TRANSLATOR SERVICE SPECIFICALLY, AND 
// COMES FROM YOUR AZURE ACCOUNT / AZURE MARKETPLACE
// YOU CAN LEARN MORE ABOUT SETTING THEM UP HERE:
// https://azure.microsoft.com/en-us/services/cognitive-services/translator-speech-api/
var clientId = 'YOUR_TRANSLATOR_APP_ID';
var clientSecret = 'YOUR_TRANSLATOR_KEY_HERE';

// THESE TWO KEYS COME FROM THE LUIS APP WE CREATE
// https://www.luis.ai/applicationlist
var luisID = 'YOUR_LUIS_APP_ID'; // <- THE ID OF OUR LUIS APP
var luisKey = 'YOUR_LUIS_KEY_HERE'; // <- THE SECRET KEY TO ACCESS THE ABOVE APP



// SETUP OUR HOSTING AND SERVE OUR STATIC FILES 
// STORED IN THE 'PUBLIC' FOLDER AS REQUESTED
var app = express();
app.use(express.static('public'));

// START THE WEB SERVER
var server = app.listen(3000, '0.0.0.0', function() {
    var host = server.address().address;
    var port = server.address().port;
    console.log("p5Vision Server running on http://%s:%s", host, port);
});

// START THE SOCKET SERVER AND HANDLERS
var io = socket(server);

// FOR THIS PROJECT, WE ARE ONLY HAVING ONE CONNECTION FROM 
// A LOCAL HOST SERVING AN INSTANCE OF OUR P5 SKETCH IN THE CLIENT
io.sockets.on('connection', newConnection);

function newConnection(socket) {

    console.log('new connection ' + socket.id);
    // ONCE A CONNECTION A MADE, WIRE UP THE THREE MAIN CALLS:

    // FORWARDING THE RECORDED MICROPHONE SOUNDBLOB FROM THE CLIENT
    // TO AUDIO TO TEXT FIRST, THEN FORWARDING TO LUIS FOR SPEECH TO INTENT
    socket.on('speechToIntent', speechToIntent);
    function speechToIntent(data) {

        console.log("\n------------------------------------");
        console.log("data received. Sending voice to text conversion first...");

        dataURL = data.audio.dataURL;
        dataURL = dataURL.split(',').pop();
        fileBuffer = new Buffer(dataURL, 'base64');

        var options = { flag : 'w' };

        // 1. WRITE THE AUDIOBLOB OF THE WAV FILE LOCALLY BEFORE PROCESSING FURTHER
        var fileName = "temp.wav";

        // NOTE: THIS MAY BE MADE MORE EFFICIENT WITH MEMORY BUFFERS, BUT THEN YOU WILL
        // WANT TO MANAGE YOUR AUDIO LENGTH AND MEMORY MANAGEMENT TOO
        fs.writeFile(fileName, fileBuffer, options, function(err) {

            // BEFORE WE CAN CALL VOICE TO TEXT, WE NEED TO GET OUR ACCESS TOKEN TO
            // THE APPROPRIATE MICROSOFT CONGNITIVE SERVICES
            getAccessToken(clientId, clientSecret, function(err, accessToken) {
  
              if(err) return console.log(err);
              console.log("Access Token received.");
              
              // ONCE WE HAVE THE ACCESS TOKEN, WE CAN NOW PROCESS SPEECH TO TEXT
              speechToText(fileName, accessToken, function(err, speechres) {
    
                if(err) return console.log("ERROR: " + err);
                console.log("SpeechToText: " + speechres.results[0].lexical);

                // ONCE WE HAVE TEXT FROM OUR SPEECH AUDIO, WE SEND THE TEXT TO LUIS
                // FOR SPEECH TO JSON INTENT PROCESSING. THIS ACTIONABLE JSON WILL BE 
                // RETURNED TO THE CLIENT FOR FINAL HANDLING
                LUIS(speechres.results[0].lexical, function(err, luisres ) {

                    if(err) return console.log("LUIS ERROR: " + err);
                    console.log("sending LUIS results back to P5 Client...")
                    console.log("-----------------------------------------");
                    socket.emit('speechToIntentResponse', luisres);
                });
              });
         });

        });

        dataURL = null;
        fileBuffer = null;
    };


    // 2. RECEIVE A WEBCAM SNAPSHOT FROM THE CLIENT AND FORWARD IT 
    // TO MSFT COG.SERVICES FOR VISION ANALYSIS 

    socket.on('snapshotToVision', snapshotToVision);
    function snapshotToVision(data) {

        console.log("sending snapshot to cogserv.vision...");

        // GET THE IMAGE AND PREP IT AS Base64 BUFFER
        data.file = data.file.split(',')[1];
        var buffer = new Buffer(data.file, 'base64');

        // SETUP OUR REQUEST
        request({
                    url: 'https://api.projectoxford.ai/vision/v1.0/analyze?visualFeatures=Description,Faces',
                    method: 'post',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Ocp-Apim-Subscription-Key': visionKey,
                    },
                    body: buffer
                }, (err, res, body) => {

                    // ONCE WE HAVE THE RESULTS, IF THERE IS NO ERROR...
                    if (err) {
                        console.log("\nERROR:\n-->" + err);
                        return;
                    }
                    // FORWARD THE JSON TO THE P5 CLIENT FOR FINAL HANDLING
                    socket.emit('snapshotToVisionResponse', JSON.stringify(body));
                    console.log("\n\nsnapshotToVisionResponse sent.");
            });
    };

    // 3. RECEIVE A WEBCAM SNAPSHOT FROM THE CLIENT AND FORWARD IT TO
    // MSFT COG.SERVICES FOR EMOTION ANALYSIS. NOTE THAT THE GENERAL
    // VISION ANALYSIS PROCESSED IN STEP 2 ABOVE DOES NOT HANDLE EMOTION,
    // SO WE NEED TO SET THIS UP AS A SEPERATE, EXPLICIT CALL TO ANOTHER REST API

    socket.on('snapshotToEmotion', snapshotToEmotion);
    function snapshotToEmotion(data) {

        console.log("sending snapshot to cogserv.emotion...");

        // GET THE IMAGE AND PREP IT AS Base64 BUFFER
        data.file = data.file.split(',')[1];
        var buffer = new Buffer(data.file, 'base64');

        // SETUP OUR REQUEST
        request({
                    url: 'https://api.projectoxford.ai/emotion/v1.0/recognize?',
                    method: 'post',
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Ocp-Apim-Subscription-Key': emotionKey,
                    },
                    body: buffer
                }, (err, res, body) => {
                    // ONCE WE HAVE A RESPONSE, IF IT'S NOT AN ERR... 
                    if (err) {
                        console.log("\nERROR:\n-->" + err);
                        return;
                    }
                    // FORWARD THE JSON TO THE P5 CLIENT FOR FINAL HANDLING
                    socket.emit('snapshotToEmotionResponse', JSON.stringify(body));
                    console.log("\n\nsnapshotToEmotionResponse sent:\n-->" + JSON.stringify(body) );
            });
    };

}

// HELPER FUNCTIONS
// ------------------------------------------------------------------
// THIS FUNCTION IS CALLED ABOVE AND RETURNS AN ACCESS TOKEN
// FOR SUBSEQUENT MICROSOFT COGNITIVE SERVICES REST API CALLS
function getAccessToken(clientId, clientSecret, callback) {
  request.post({
    url: 'https://oxford-speech.cloudapp.net/token/issueToken',
    form: {
      'grant_type': 'client_credentials',
      'client_id': encodeURIComponent(clientId),
      'client_secret': encodeURIComponent(clientSecret),
      'scope': 'https://speech.platform.bing.com'
    }
  }, function(err, resp, body) {
    if(err) return callback(err);
    try {
      var accessToken = JSON.parse(body).access_token;
      if(accessToken) {
        callback(null, accessToken);
      } else {
        callback(body);
      }
    } catch(e) {
      callback(e);
    }
  });
}

// THIS IS THE FUNCTION THAT CALLS THE SPEECH TO TEXT REST API
// AND CALLS THE CALLBACK FUNCTION DEFINED ABOVE WITH THE RESULTS
function speechToText(filename, accessToken, callback) {

  fs.readFile(filename, function(err, waveData) {
    if(err) return callback(err);

    console.log("sending speecht to text...");

    request.post({
      url: 'https://speech.platform.bing.com/recognize/query',
      qs: {
        'scenarios': 'ulm',
        'appid': encodeURIComponent(speechToTextRequiredAppID),
        'locale': 'en-US',
        'device.os': 'wp7',
        'version': '3.0',
        'format': 'json',
        'requestid': '99999999-9999-9999-9999-999999999999', // THIS CAN BE ANY VALUE, NOT USED BUT REQUIRED
        'instanceid': '99999999-9999-9999-9999-999999999999' // THIS CAN BE ANY VALUE, NOT USED BUT REQUIRED
      },
      body: waveData,
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'audio/wav; samplerate=8000',// changed from samplerrate=16000
        'Content-Length' : waveData.length
      }
    }, function(err, resp, body) {
      if(err) return callback(err);
      try {
        callback(null, JSON.parse(body));
      } catch(e) {
        callback(e);
      }
    });
  });
}

// THIS IS THE FUNCTION THAT CALLS LUIS WITH THE AUDIO TO TEXT
// RESULTS AND THEN CALLS THE CALLBACK FUNCTION WITH THE JSON RESULTS
function LUIS(query, callback) {
    request.get({
      url: 'https://api.projectoxford.ai/luis/v1/application',
      qs: {
        'id': luisID, 
        'subscription-key': luisKey,
        'q': query
      }
    }, function(err, resp, body) {
      if(err) return callback(err);
      try {
        callback(null, JSON.parse(body));
      } catch(e) {
        callback(e);
      }
    });
}

