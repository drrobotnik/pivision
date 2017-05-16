var webcam;
var snapshot;
var socket;
var speakOut;
var mic, recorder, soundFile;

var wavblob = null;
var people = [];
var things = "";
var emotions = [];

var callback;

var hasSnapshot = false;
var showPeople = false;
var showEmotions = false;

function setup() {

    // SETUP OUR MICROPHONE, RECORDER AND SOUND FILE 
    // FOR RECORDING SPOKEN REQUESTS
    mic = new p5.AudioIn();
    mic.start();
    recorder = new p5.SoundRecorder();
    recorder.setInput(mic);
    recorder.state = 0;
    recorder.silenceDuration = 0;
    soundFile = new p5.SoundFile();

    // CREATE OUR WEBCAM DOM ELEMENT AND ADD IT TO 
    // OUR CONTAINING DIV FIRST, TO BE ON THE LEFT OF THE SKETCH
    webcam = createCapture(VIDEO);
    webcam.size(640, 640);
    webcam.parent('p5host');

    // SETUP A P5 IMAGE FOR TAKING A SNAPSHOT OF THE WEBCAM 
    // AND SENDING TO THE SERVER FOR ANALYSIS
    snapshot = createImage(640, 640);

    // NOW CREATE OUR INTERACTIVE CANVAS AND IT TO OUR CONTAINING DIV
    var canvas = createCanvas(640,640);
    canvas.parent('p5host');
    
    // SETUP OUR SOCKET SERVER FOR BACK AND FORTH COMMUNICATION
    // WITH OUR SERVER WHICH WILL FORWARD CALLS TO COGNITIVE SERVICES
    socket = io.connect('https://0.0.0.0');

    // THIS RESPONSE IS FIRED WHEN OUR SPEECH REQUEST HAS BEEN PROCESSED TO INTENT
    socket.on('speechToIntentResponse', speechToIntentResponse);
    // THIS RESPONSE IS FIRED WHEN OUR IMAGE HAS BEEN PROCESSED BY COG.SERVICES->VISION
    socket.on('snapshotToVisionResponse', snapshotToVisionResponse);
    // THIS RESPONSE IS FIRED WHEN OUR IMAGE HAS BEEN PROCESSED BY COG.SERVICES->EMOTION
    socket.on('snapshotToEmotionResponse', snapshotToEmotionResponse);

    //socket.on('DetectorResponse', DetectorResponse);

    socket.on( 'DetectorResponseSound', DetectorResponseSound );

    socket.on( 'DetectorResponseHotWord', DetectorResponseHotWord );

    socket.on( 'DetectorResponseActionWord', DetectorResponseActionWord );

    socket.on( 'DetectorResponseSilence', DetectorResponseSilence );

    // CREATE THE ABILITY FOR THE SOFTWARE TO SPEAK OUT OUR SERVER RESULTS
    speakOut = new p5.Speech();

}

/****************************************************
 *  1] CONVERTING THE AUDIO INTO ACTIONABLE INTENT
*****************************************************/

function DetectorResponse( $response ) {
    console.log( $response );
}

function DetectorResponseSound( $response ) {
    console.log( $response );
    
    if( ! $('body').hasClass('listening') && ! $('body').hasClass('recording') ) {
        $('body').addClass('listening');
    }
}


function DetectorResponseHotWord( $response ) {
    if( 1 !== recorder.state ) {
        console.log( $response );
        if( ! $('body').hasClass('recording') ) {
            $('body').addClass('recording');
        }
        recorder.record(soundFile);
    }

    recorder.silenceDuration = 0;
    recorder.state = 1;
}

function DetectorResponseActionWord( $response ) {
    
    if( 1 === recorder.state ) {
        applyAction( $response.hotword );
        console.log( $response.hotword );
        console.log('action word detected while recording');
    }else{
        console.log( $response );
    }
}

function DetectorResponseSilence( $response ) {
    if( 1 === recorder.state && recorder.silenceDuration === 8 ) {

        recorder.stop();
        if( $('body').hasClass('recording') ) {
            $('body').removeClass('recording');
        }
        speechToIntent();
        recorder.silenceDuration = 0;
        recorder.state = 0;
    }

    if( $('body').hasClass('listening') ) {
        $('body').removeClass('listening');
    }
    recorder.silenceDuration++;
    
}

function applyAction( $action ) { console.log('the action is: ' + $action);
    switch ( $action ) {
        case "take a picture":
            takePhoto();
            break;
        case "detect faces":
            findHumans();
            break;
        case "FindThings":
            findThings();
            break;
        case "FindEmotions":
            findEmotions();
            break;
        case "Translate":
            break;
    }
}

function speechToIntent() {
    // THIS ALWAYS INDICATES A NEW REQUEST FOR INFORMAITON
    // SO CLEAR ANY EXISTING CALLBACKS FOR HANDLING NESTED QUERIES
    callback = null;

    //soundFile.play();

    // GET THE AUDIO RECORDING FROM P5 AS A BLOB
    sendblob = getSoundBlob(soundFile);

    // CREATE A 'FileReader' WHICH CAN READ THE BLOB AS A DATAURL
    var reader = new FileReader();

    // WHEN THE READER IS FINISHED LOCALLY CONVERTING THE BLOB
    // TO A DATAURL READY FOR TRANSMISSION, SEND IT TO OUR SERVER FOR PROCESSING
    reader.addEventListener("load", function() {
        var files = {
            audio: {
                dataURL: this.result
            }
        }
        socket.emit("speechToIntent", files );
    });

    // START THE CONVERSION PROCESS BY READING IN THE AUDIO BLOB
    reader.readAsDataURL(sendblob);
}

function speechToIntentResponse(data) {
// THIS EVENT IS FIRED BY A RESPONSE FROM THE SERVER ONCE OUR AUDIO
// RECORDED BY THE CLIENT HAS BEEN CONVERTED TO JSON VIA THE LUIS MODEL 
// WE CREATED AT 'https://www.luis.ai/'

    var intent = data['intents'][0]['intent'];

    switch ( intent ) {
        case "TakePhoto":
            takePhoto();
            break;
        case "FindHumans":
            findHumans();
            break;
        case "FindThings":
            findThings();
            break;
        case "FindEmotions":
            findEmotions();
            break;
        case "Translate":
            break;
    }
}

/****************************************************
 *  1] HANDLING THE TAKEPHOTO() REQUEST
*****************************************************/

function takePhoto() {
    // IT'S A NEW PHOTO, SO CLEAR OUT ALL PREVIOUS DATA
    people = [];
    emotions = [];
    things = "";
    showPeople = false;
    showEmotions = false;

    // TAKE A SNAPSHOT OF THE CURRENT IMAGE IN THE WEBCAM
    snapshot.loadPixels();
    webcam.loadPixels();

    console.log(snapshot);
    for ( var x = 0; x < snapshot.width; x++ ) {
        for ( var y = 0; y < snapshot.height*4; y++ ) {
            var i = y * webcam.width + x;
            snapshot.pixels[i] = webcam.pixels[i];
        }
    } 
    snapshot.updatePixels();
    webcam.updatePixels();
    hasSnapshot = true;

    // SEND OUR SNAPSHOT TO THE SERVER FOR VISION ANALYSIS
    socket.emit('snapshotToVision', { file: snapshot.canvas.toDataURL() });
}

function snapshotToVisionResponse(data) {
    // THIS IS FIRED BY THE SERVER ONCE THE SNAPSHOT HAS BEEN 
    // PROCESSED AND THE ANALYSIS DATA IS RETURNED AS 'data'

    // FOR SOME REASON, NEED TO DOUBLE CONVERT TO JSON, NOT SURE WHY...
    var rawResponse = JSON.parse(data);
    var response = JSON.parse(rawResponse);

    // CONVERT THE 0.0 - 1.0 CONFIDENCE SCORE TO A PERCENTAGE VALUE EASIER TO SPEAK
    var confidence  = Math.round( response.description.captions[0].confidence * 10000.0 ) / 100;

    // IMMEDIATELY SPEAK OUT THE NATURAL LANGUAGE DESCRIPTION 
    var out = "I am " + confidence + " percent sure I see '" + response.description.captions[0].text + "'";
    speakOut.speak(out);
    print(out);

    // POPULATE OUR PEOPLE DATA IF AVAILABLE
    for ( var i = 0; i < response.faces.length; i++ ) {
        var person = {
            gender: response.faces[i].gender,
            age: response.faces[i].age,
            left: response.faces[i].faceRectangle.left,
            top: response.faces[i].faceRectangle.top - 10,
            width: response.faces[i].faceRectangle.width,
            height: response.faces[i].faceRectangle.height + 10
        }
        people.push(person);
    }

    // POPULATE OUR DESCRIPTION TAGS
    for ( var i = 0; i < response.description.tags.length; i++ ) {
        things += response.description.tags[i] + ", ";
    }

    // SINCE TAKEPHOTO IS OUR CORE FUNCTIONALITY, IT MAY BE NESTED IN
    // A MORE COMPLEX REQUEST BEFORE ANY PHOTOS ARE TAKEN, SO WE ARE
    // USING A CALLBACK SCHEME TO HANDLE MORE COMPLEX COMMANDS THAT WOULD
    // FIRST REQUEST THE PHOTO TO BE TAKEN.

    // FOR EXAMPLE, IF I JUST SAID 'Take a picture', THEN WE WOULD BE DONE
    // AT THIS POINT AND CALLBACK WOULD BE NULL. BUT IF I HAD SAID 
    // 'WHAT HUMANS DO YOU SEE?' BEFORE A PICTURE WAS TAKEN, I WOULD HAVE TO 
    // FIRST TAKE A PICTURE AND THEN CALLBACK ADDITIONAL REQUESTS FOR HANDLING
    // THE FINDHUMANS FUNCTIONALITY ONLY AFTER THE PICTURE WAS PROCESSED
    if ( callback ) callback();
}


/****************************************************
 *  2] HANDLING THE FINDHUMANS() REQUEST
 * 
 *  NOTE: THIS REQUEST CAN BE HANDLED BY THE 
 *  DEFAULT DATA RETURNED FROM 'snapshotToVisionResponse()'
 *  SO DOES NOT REQUEST ADDITIONAL SERVER REQUESTS ONCE
 *  THE INITIAL PHOTO HAS BEEN PROCESSED
*****************************************************/

function findHumans() {
    // IF WE DON'T ALREADY HAVE A PICTURE,
    // WE NEED TO TAKE AND PROCESS THE PICTURE
    // FIRST BEFORE WE DISPLAY THE HUMANS
    if ( !hasSnapshot ) {
        // SO IF NO SNAPSHOT EXISTS, HANDLE THAT FIRST
        // AND HAVE THE CALLBACK CALL US AGAIN ONCE FINISHED
        callback = findHumans;
        takePhoto();
    } else {
        // WE ALREADY HAVE A PICTURE, SO WE CAN NOW
        // QUERY ANY LOCAL PERSON DATA RETURN FROM THE VISION ANALYSIS 
        if ( people.length > 0 ) {
            // SET OUR DRAW FLAG TO REQUEST A VISUAL INDICATOR
            showPeople = true;
            // SPEAK OUT THE PERSON RESULTS
            for ( var i = 0; i < people.length; i++ ) {
                var person = people[i];
                var description = "I see a " + person.gender + " who appears to be " + person.age + " years old.";
                speakOut.speak(description);
            }
        } else {
            speakOut.speak("I am sorry, I do not see any humans");
        }
    }
}

/****************************************************
 *  3] HANDLING THE FINDTHINGS() REQUEST
 * 
 *  NOTE: THIS REQUEST CAN BE HANDLED BY THE 
 *  DEFAULT DATA RETURNED FROM 'snapshotToVisionResponse()'
 *  SO DOES NOT REQUEST ADDITIONAL SERVER REQUESTS ONCE
 *  THE INITIAL PHOTO HAS BEEN PROCESSED
*****************************************************/

function findThings() {
    // IF WE DON'T ALREADY HAVE A PICTURE,
    // WE NEED TO TAKE AND PROCESS THE PICTURE
    // FIRST BEFORE WE CAN ITERATE THROUGH THE ITEMS FOUND
    if ( !hasSnapshot ) {
        // SO IF NO SNAPSHOT EXISTS, HANDLE THAT FIRST
        // AND HAVE THE CALLBACK CALL US AGAIN ONCE FINISHED
        callback = findThings;
        takePhoto();
    } else {
        // WE ALREADY HAVE A PICTURE, SO WE CAN NOW VERBALIZE
        // THE DESCRIPTION TAGS RETURNED AND PROCESSED IN 'snapshotToVisionResponse()'
        if ( things == "" ) {
            speakOut.speak("I'm sorry. I am having trouble describing this picture");
        } else {
            var phraseOut = "I believe I see the following : " + things;
            speakOut.speak(phraseOut);
        }
    }
}


/****************************************************
 *  4] HANDLING THE FINDEMOTIONS() REQUEST
 * 
 *  NOTE: THIS REQUEST REQUIRES A NEW CALL TO THE
 *  SERVER SINCE COGNITIVE.SERVICES->VISION DOES NOT
 *  INCLUDE EMOTIONAL INTELLIGENCE SO WE NEED TO 
 *  SEND THE SNAPSHOT TO COGNITIVE.SERVICES->EMOTION
 *  AND PROCESS THE RESULTS.
*****************************************************/

function findEmotions() {    
    // IF WE HAVEN'T TAKEN A SNAPSHOT, WE NEED TO DO THAT FIRST
    // AND SETUP THE CALLBACK TO CALL US BACK ONCE THAT IS FINISHED.
    if ( !hasSnapshot ) {
        callback = findEmotions;
        takePhoto();
    } else if ( people.length > 0 && !showEmotions ) {
        // WE ONLY NEED TO PROCESS IF WE FOUND PEOPLE BUT HAVEN'T
        // PROCESSED EMOTIONS
        showEmotions = true;
        callback = findEmotions;
        socket.emit('snapshotToEmotion', { file: snapshot.canvas.toDataURL() });        
    } else {
        // WE WOULD ONLY HAVE EMOTIONS IF WE HAVE ALREADY PROCESSED THEM
        // SO THIS WOULD BE A REPEAT REQUEST ON THE SAME PICTURE
        if ( emotions.length > 0 ) {
            // SPEAK OUT OUR RESULTS AND SET THE DRAW FLAG FOR VISUAL INDICATORS
            showEmotions = true;
            for ( var i = 0; i < emotions.length; i++ ) {
                  var emotion = emotions[i];
                  var description = "I am " + emotion.confidence + " percent sure that this face is feeling " + emotion.feeling + ".";
                  speakOut.speak(description);
            }
        } else {
               speakOut.speak("I am sorry, I do not see any humans for emotion analysis");
        }
    }
}


function snapshotToEmotionResponse(data) {
    // THIS IS FIRED BY THE SERVER ONCE THE SNAPSHOT HAS BEEN 
    // PROCESSED FOR EMOTION DETECTION WITH RESULTS RETURNED AS 'data'

    var rawResponse = JSON.parse(data);
    var response = JSON.parse(rawResponse);
    
    for ( var i = 0; i < response.length; i++ ) {
        var facerec = response[i];

        // THE EMOTIONAL ANALYSIS RESULTS ARE RETURNED AS JSON
        // BUT THEY ARE NOT ORDED, SO WE CAN'T ASSUME THE FIRST RESULTS
        // IS THE HIGHEST. WE NEED TO LOOP THROUGH THE DATA OBJECT AND
        // SORT THE SCORES TO DETERMINE THE EMOTION (KEY) THAT HAS HIGHEST RANKING
        var topScore = 0;
        var topKey = "";

        Object.keys(response[i].scores).forEach(function(key) 
        { 
            if ( response[i].scores[key] > topScore )
            {
                topScore = response[i].scores[key];
                topKey = key;
            }
        });

        var confidence  = Math.round( topScore * 10000.0 ) / 100;

        // POPULATE THE EMOTION ANALYSIS RESULTS INTO OUR LOCAL CLIENT COLLECTION
        var emotion = {
            feeling: topKey,
            confidence: confidence,
            left: response[i].faceRectangle.left + 5,
            top: response[i].faceRectangle.top - 4,
            width: response[i].faceRectangle.width - 10,
            height: response[i].faceRectangle.height - 5
        }
        emotions.push(emotion);
    }

    // THIS CALLSBACK TO OUR ORIGINAL 'FindEmotion()' FUNCTION WHICH WILL
    // TAKE THE RESULTS NOW STORED INTO THE EMOTIONS ARRAY AND SPEAK THEM BACK
    if ( callback ) callback();
}

/****************************************************
 *  5] HANDLING OUR DRAW LOOP
*****************************************************/

function draw() {

    background(22,27,30);

    // IF WE HAVE A SNAPSHOT OF THE WEBCAM, RENDER IT TO SCREEN
    if ( snapshot ) image(snapshot, 0, 0);

    // IF THE SHOWPEOPLE FLAG IS SET AND PEOPLE DETECTED, 
    // DRAW THE PEOPLE INDICATORS.
    if ( showPeople && people.length > 0 ) {
 
        drawIndicators(
            people, // THE GROUP TO INDICATE
            { "lbl0": "gender", "lbl1": "age", "lbl2" : " YEARS"},  // LABEL DATA
            6, // SQUARE SIZE
            107, 246, 212, // R,G,B COLORS
             -7 // TOP OFFSET 
            ); 
    }

    if ( showEmotions && emotions.length > 0 ) {

        drawIndicators(
            emotions, // THE GROUP TO INDICATE
            { "lbl0": "feeling", "lbl1": "confidence", "lbl2" : "%"},  // LABEL DATA
            4, // SQUARE SIZE
            255, 255, 255, // R,G,B COLORS
             14 // TOP OFFSET 
            ); 
    }

}

function drawIndicators(group, label, size, r, g, b, topOffset) {
    
    var halfSize = size * .5;

    for ( var i = 0; i < group.length; i++ ) {

        // DRAW THE BOUNDING BOX
        noFill();
        stroke(r,g,b,150);
        strokeWeight(1);
        var current = group[i];
        rect(current.left, current.top, current.width, current.height);

        // DRAW THE CORNDER SQUARES
        fill(r,g,b);
        noStroke();

        rect(current.left - halfSize, current.top - halfSize, size, size);
        rect(current.left + current.width - halfSize, current.top - halfSize, size, size);
        rect(current.left - halfSize, current.top + current.height - halfSize, size, size);
        rect(current.left + current.width - halfSize, current.top + current.height - halfSize, size, size);

        // PRINT THE LABELED VALUES
        var currentDesc = current[label.lbl0] + ", " + current[label.lbl1] + label.lbl2;
        text(currentDesc.toUpperCase(), current.left + size, current.top + topOffset);
    }

}