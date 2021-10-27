/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var ws = new WebSocket('wss://' + location.host + '/magicmirror');
var videoInput;
var videoOutput;
var webRtcPeer;
var state = null;

const I_CAN_START = 0;
const I_CAN_STOP = 1;
const I_AM_STARTING = 2;

const codecPreferences = document.querySelector('#codecPreferences');
const supportsSetCodecPreferences = window.RTCRtpTransceiver && 'setCodecPreferences' in window.RTCRtpTransceiver.prototype;

window.onload = function () {
	console = new Console();
	console.log('Page loaded ...');
	videoInput = document.getElementById('videoInput');
	videoOutput = document.getElementById('videoOutput');
	setState(I_CAN_START);
	
	if (supportsSetCodecPreferences) {
		console.log('Supports Codec Preferences')
		const {codecs} = RTCRtpSender.getCapabilities('video');
		codecs.forEach(codec => {
		if (['video/red', 'video/ulpfec', 'video/rtx'].includes(codec.mimeType)) {
			return;
		}
		const option = document.createElement('option');
		option.value = (codec.mimeType + ' ' + (codec.sdpFmtpLine || '')).trim();
		option.innerText = option.value;
		codecPreferences.appendChild(option);
		});
		codecPreferences.disabled = false;
	}
}

window.onbeforeunload = function () {
	ws.close();
}

ws.onmessage = function (message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
		case 'startResponse':
			startResponse(parsedMessage);
			break;
		case 'error':
			if (state == I_AM_STARTING) {
				setState(I_CAN_START);
			}
			onError('Error message from server: ' + parsedMessage.message);
			break;
		case 'iceCandidate':
			webRtcPeer.addIceCandidate(parsedMessage.candidate)
			break;
		case 'ffmpeg':
			console.log('From ffmpeg:', parsedMessage.message);
			break;
		default:
			if (state == I_AM_STARTING) {
				setState(I_CAN_START);
			}
			onError('Unrecognized message', parsedMessage);
	}
}




function setCodec() {
	if (supportsSetCodecPreferences) {
	  const preferredCodec = codecPreferences.options[codecPreferences.selectedIndex];
	  if (preferredCodec.value !== '') {
		const [mimeType, sdpFmtpLine] = preferredCodec.value.split(' ');
		const {codecs} = RTCRtpSender.getCapabilities('video');
		const selectedCodecIndex = codecs.findIndex(c => c.mimeType === mimeType && c.sdpFmtpLine === sdpFmtpLine);
		const selectedCodec = codecs[selectedCodecIndex];
		codecs.splice(selectedCodecIndex, 1);
		codecs.unshift(selectedCodec);
		console.log(codecs);
		const transceiver = webRtcPeer.getPeerConnection().getTransceivers().find(t => t.sender && t.sender.track === localStream.getVideoTracks()[0]);
		transceiver.setCodecPreferences(codecs);
		console.log('Preferred video codec', selectedCodec);
		console.log('Transceiver', transceiver);
	  }
	}
	codecPreferences.disabled = true;
	// Display the video codec that is actually used.
	setTimeout(async () => {
	  const stats = await webRtcPeer.getPeerConnection().getStats();
	  stats.forEach(stat => {
		if (!(stat.type === 'outbound-rtp' && stat.kind === 'video')) {
		  return;
		}
		const codec = stats.get(stat.codecId);
		console.log('codec: ', codec);
		document.getElementById('actualCodec').innerText = 'Using ' + codec.mimeType +
		  ' ' + (codec.sdpFmtpLine ? codec.sdpFmtpLine + ' ' : '') +
		  ', payloadType=' + codec.payloadType + '.';
	  });
	}, 1000);
}


function start() {
	console.log('Starting video call ...')

	// Disable start button
	setState(I_AM_STARTING);

	console.log('Creating WebRtcPeer and generating local sdp offer ...');

	var options = {
		localVideo: videoInput,
		onicecandidate: onIceCandidate,
		mediaConstraints: {
			audio: true,
			video: {
				width: 720,
				framerate: 30
			}
    	}
	}

	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function (error) {
		if (error) return onError(error);
		this.generateOffer(onOffer);
	});
}

function onIceCandidate(candidate) {
	console.log('Local candidate' + JSON.stringify(candidate));

	var message = {
		id: 'onIceCandidate',
		candidate: candidate
	};
	sendMessage(message);
}

function switchPlatform() {
	var message = {
		id: 'switchPlatform'
	};
	sendMessage(message)
}

function onOffer(error, offerSdp) {
	if (error) return onError(error);

	console.info('Invoking SDP offer callback function ' + location.host);
	var message = {
		id: 'start',
		sdpOffer: offerSdp
	}
	sendMessage(message);
}

function onError(error) {
	console.error(error);
}

function startResponse(message) {
	setState(I_CAN_STOP);
	console.log('SDP answer received from server. Processing ...');
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function stop() {
	console.log('Stopping video call ...');
	setState(I_CAN_START);
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;

		var message = {
			id: 'stop'
		}
		sendMessage(message);
	}
	hideSpinner(videoInput, videoOutput);
}

function setState(nextState) {
	switch (nextState) {
		case I_CAN_START:
			$('#start').attr('disabled', false);
			$('#start').attr('onclick', 'start()');
			$('#switch').attr('onclick', 'switchPlatform()');
			$('#setCodec').attr('onclick', 'setCodec()');
			$('#stop').attr('disabled', true);
			$('#stop').removeAttr('onclick');
			break;

		case I_CAN_STOP:
			$('#start').attr('disabled', true);
			$('#stop').attr('disabled', false);
			$('#stop').attr('onclick', 'stop()');
			break;

		case I_AM_STARTING:
			$('#start').attr('disabled', true);
			$('#start').removeAttr('onclick');
			$('#stop').attr('disabled', true);
			$('#stop').removeAttr('onclick');
			break;

		default:
			onError('Unknown state ' + nextState);
			return;
	}
	state = nextState;
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Senging message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function showSpinner() {
	for (var i = 0; i < arguments.length - 1; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (var i = 0; i < arguments.length - 1; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function (event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});


