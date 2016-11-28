  /**
   *  Get a p5.SoundFile as a blob .wav file for sending
   *  to the server. Adapted from p5.sound.saveSound() code
   * 
   *  @method getSoundBlob
   *  @param  {p5.SoundFile} soundFile p5.SoundFile that you wish to save
   */
  p5.prototype.getSoundBlob = function (soundFile) {
    var leftChannel, rightChannel;
    leftChannel = soundFile.buffer.getChannelData(0);
    // handle mono files
    if (soundFile.buffer.numberOfChannels > 1) {
      rightChannel = soundFile.buffer.getChannelData(1);
    } else {
      rightChannel = leftChannel;
    }
    var interleaved = interleave(leftChannel, rightChannel);
    // create the buffer and view to create the .WAV file
    var buffer = new ArrayBuffer(44 + interleaved.length * 2);
    var view = new DataView(buffer);
    // write the WAV container,
    // check spec at: https://ccrma.stanford.edu/courses/422/projects/WaveFormat/
    // RIFF chunk descriptor
    writeUTFBytes(view, 0, 'RIFF');
    view.setUint32(4, 36 + interleaved.length * 2, true);
    writeUTFBytes(view, 8, 'WAVE');
    // FMT sub-chunk
    writeUTFBytes(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    // stereo (2 channels)
    view.setUint16(22, 2, true);
    view.setUint32(24, 44100, true);
    view.setUint32(28, 44100 * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    // data sub-chunk
    writeUTFBytes(view, 36, 'data');
    view.setUint32(40, interleaved.length * 2, true);
    // write the PCM samples
    var lng = interleaved.length;
    var index = 44;
    var volume = 1;
    for (var i = 0; i < lng; i++) {
      view.setInt16(index, interleaved[i] * (32767 * volume), true);
      index += 2;
    }
    var type = 'application\/octet-stream';
    return new Blob([view], {'type': type });
  };
    // helper methods to save waves
  function interleave(leftChannel, rightChannel) {
    var length = leftChannel.length + rightChannel.length;
    var result = new Float32Array(length);
    var inputIndex = 0;
    for (var index = 0; index < length;) {
      result[index++] = leftChannel[inputIndex];
      result[index++] = rightChannel[inputIndex];
      inputIndex++;
    }
    return result;
  }
  function writeUTFBytes(view, offset, string) {
    var lng = string.length;
    for (var i = 0; i < lng; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

