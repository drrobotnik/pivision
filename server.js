// THESE DEPENDENCIES COME DEFAULT WITH NODE
var https = require('https'),
	util = require('util'),
	fs = require('fs'),
	sox = require('sox'),
	wav = require('wav'),
	record = require('node-record-lpcm16'),
	Models = require('./models.js').Models,
	Detector = require('./models.js').Detector,
	ActionModels = require('./models.js').Models,
	ActionDetector = require('./models.js').Detector,
	
	Speech = require('@google-cloud/speech'),
	express = require('express'),
	WordPOS = require('wordpos'),
	wordpos = new WordPOS({stopwords: true}),

	projectId = 'pi-society',
	sampleRate = 16000,

	models = new Models(),
	action_models = new ActionModels(),
	app = express(),
	serverPort = 443;

app.use(express.static('public'));

var options = {
	key: fs.readFileSync('./file.pem'),
	cert: fs.readFileSync('./file.crt')
};

var server = https.createServer(options, app),
	io = require('socket.io')(server);

models.add({
	file: 'resources/Caava.pmdl',
	sensitivity: '0.5',
	hotwords : 'caava'
});

var detector = new Detector({
	resource: "resources/common.res",
	models: models,
	audioGain: 1.0
	//audioGain: 2.0
});

action_models.add({
	file: 'resources/take_a_picture.pmdl',
	sensitivity: '0.6',
	hotwords : 'take a picture'
});

action_models.add({
	file: 'resources/detect_faces.pmdl',
	sensitivity: '0.6',
	hotwords : 'detect faces'
});

var action_detector = new ActionDetector({
	resource: "resources/common.res",
	models: action_models,
	audioGain: 1.0
	//audioGain: 2.0
});

server.listen(serverPort, function() {
	console.log('server up and running at %s port', serverPort);
});

io.on('connection', newConnection);


function newConnection( socket ) {

	console.log('new connection ' + socket.id);

	detector.on('silence', function() {
		socket.emit('DetectorResponseSilence', 'silence');
	});

	detector.on('sound', function() {

		var date = new Date();

		var year = date.getFullYear();
		var month = date.getMonth() + 1;
		var day = date.getDate();
		var hours = date.getHours();
		var minutes = date.getMinutes();
		var seconds = date.getSeconds();
		console.log('sound ' + year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds);
		socket.emit('DetectorResponseSound', 'sound');
	});

	detector.on('error', function() {
		console.log('error');
		socket.emit('DetectorResponseError', 'error');
	});

	detector.on( 'hotword', function( index, hotword ) {
		console.log( 'actionword', index, hotword );
		socket.emit( 'DetectorResponseHotWord', { index, hotword });
	});

	action_detector.on('hotword', function(index, hotword) {
		console.log('actionword', index, hotword);
		socket.emit('DetectorResponseActionWord', { index, hotword });
	});



	const mic = record.start({
		threshold: 0,
		verbose: false,
		sampleRate: sampleRate
	});

	mic.pipe(detector);
	mic.pipe(action_detector);

	socket.on('speechToIntent', speechToIntent);

	function callback(err, operation, apiResponse) {
		if (err) {
			console.log('error: ' + err );
		}

		operation.on('error', function( err ) {
			console.log( 'operation error: ' + err );
		}).on('complete', function(transcript) {
			console.log( transcript );
		});
	}

	function speechToIntent(data) {

		console.log("data received. Sending voice to text conversion first...");

		var dataURL = data.audio.dataURL,
			options = { flag : 'w' },
			fileName = "temp.wav";

		dataURL = dataURL.split(',').pop();
		var fileBuffer = new Buffer(dataURL, 'base64');
		
		fs.writeFile(fileName, fileBuffer, options, function(err) {

			dataURL = null;
			fileBuffer = null;
			file = null;

			/* @todo re-work so this fires on action word recognition failure
			// --rate 16k --bits 16 --channels 1
			var job = sox.transcode('temp.wav', 'temp.flac', {
				sampleRate: 16000,
				format: 'FLAC',
				channelCount: 1,
				bitRate: ( 192 * 1024 ) / 2,
				compressionQuality: 8
			});

			job.err = 0;

			job.start();


			job.on('error', function(err) {
				console.error(err);
				job.err = 1;
			});

			job.on('end', function() {
				console.log( job.err );
				
				if( 0 === job.err ) {
					google_speech_stuff();
					//console.log('...mmrewerr google speech stuff mrewwerr...');
				}
				
				console.log("all done");
			});
			*/
		});

		dataURL = null;
		fileBuffer = null;

	}

	socket.on('snapshotToVision', snapshotToVision);
    function snapshotToVision(data) {

        console.log("processing snapshot for faces...");

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
                    socket.emit(, JSON.stringify(body));
                    console.log("\n\nsnapshotToVisionResponse sent.");
            });
    };

}

function get_entities( $text ) {
	wordpos.getPOS($text, function( result ) {
		console.log(result);
	});
/*
	wordpos.getAdjectives($text, function( result ) {
		console.log(result);
	});

	wordpos.getNouns($text, function( result ) {
		console.log(result);
	});

	wordpos.getVerbs($text, function( result ) {
		console.log(result);
	});

	wordpos.isAdjective('awesome', function(result) {
		console.log(result);
	});
*/
}

function google_speech_stuff() {
	// Instantiates a client
	var speechClient = Speech({
		projectId: projectId
	});

	var config = {
		encoding: 'FLAC',
		sampleRate: 16000
	};

	function callback(err, transcript, apiResponse) {
		if (err) {
			console.log( 'error: ' + err );
		}else{
			console.log( 'transcript' );
			console.log( transcript );
			var entities = get_entities( transcript );

		}

		console.log(apiResponse);

	}

	speechClient.recognize('./temp.flac', config, callback);
}
