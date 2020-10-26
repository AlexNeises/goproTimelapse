const http = require('http');
const Jimp = require('jimp');
const AWS = require('aws-sdk');
const { DateTime } = require('luxon');
const { password, bucket } = require('./config.json');

const credentials = new AWS.SharedIniFileCredentials({ profile: 'timelapse' });
AWS.config.credentials = credentials;

const deleteFromCamera = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '10.5.5.9',
      path: `/camera/DL?t=${ password }`,
      method: 'GET'
    };

    http.request(options, res => {
      if (res.statusCode !== 200) {
        console.error('Error deleting picture.');
        return reject();
      }
      res.on('data', () => { });
      res.on('end', () => {
        console.log('Picture deleted!');
        return resolve();
      });
    }).on('error', e => {
      console.error(e);
      return reject();
    }).end();
  });
}

const getFilename = () => {
  return new Promise((resolve, reject) => {
    const s3 = new AWS.S3({
      region: 'us-east-1'
    });

    return s3.listObjectsV2({
      Bucket: bucket
    }, (err, data) => {
      if (err) {
        console.error(err);
        return reject();
      }
      if (data.KeyCount) {
        const filename = ('00000' + (parseInt(data.Contents.sort((a, b) => {
          return new Date(b.LastModified) - new Date(a.LastModified);
        })[0].Key.split('.').slice(0, -1).join('.')) + 1)).slice(-6) + '.jpg';
        return resolve(filename);
      } else {
        return resolve('000001.jpg');
      }
    });
  });
};

const sendToS3 = (buffer, filename) => {
  const s3 = new AWS.S3({
    region: 'us-east-1'
  });
  const s3UploadConfig = {
    ACL: 'bucket-owner-full-control',
    Body: buffer,
    Bucket: bucket,
    ContentType: 'image/jpeg',
    Key: filename
  };
  return s3.putObject(s3UploadConfig).promise();
};

const addTimestamp = (file, ts) => {
  return new Promise((resolve, reject) => {
    return Promise.all([Jimp.read(file), Jimp.loadFont('./font/cutive_mono_regular_64.fnt')]).then(([image, font]) => {
      image.print(font, 10, 10, ts).getBuffer(Jimp.MIME_JPEG, (err, buffer) => {
        if (err) {
          console.error(err);
          return reject();
        }
        return getFilename().then(filename => {
          return sendToS3(buffer, filename).then(() => {
            return deleteFromCamera().then(() => {
              return resolve();
            }).catch(e => {
              console.error(e);
              return reject();
            });
          }).catch(e => {
            console.error(e);
            return reject();
          });
        }).catch(e => {
          console.error(e);
          return reject();
        });
      });
    }).catch(e => {
      console.error(e);
      return reject();
    });
  });
};

const getPictureLocation = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '10.5.5.9',
      port: 8080,
      path: '/gp/gpMediaList',
      method: 'GET'
    };

    http.request(options, res => {
      if (res.statusCode !== 200) {
        console.error('Error retrieving files.');
        return reject();
      }
      res.setEncoding('utf-8');
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      res.on('end', () => {
        const files = JSON.parse(data);
        const dir = files.media[files.media.length - 1];
        const fn = dir.fs[dir.fs.length - 1];
        const filepath = `http://10.5.5.9:8080/videos/DCIM/${ dir.d }/${ fn.n }`;
        addTimestamp(filepath, DateTime.local().toFormat('yyyy-LL-dd HH:mm')).then(() => {
          return resolve();
        }).catch(() => {
          return reject();
        });
      });
    }).on('error', e => {
      console.error(e);
      return reject();
    }).end();
  });
};

const takePicture = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '10.5.5.9',
      path: `/camera/SH?t=${ password }&p=%01`,
      method: 'GET'
    };

    http.request(options, res => {
      if (res.statusCode !== 200) {
        console.error('Error taking picture.');
        return reject();
      }
      res.on('data', () => { });
      res.on('end', () => {
        console.log('Picture taken!');
        return getPictureLocation().then(() => {
          return resolve();
        }).catch(() => {
          return reject();
        });
      });
    }).on('error', e => {
      console.error(e);
      return reject();
    }).end();
  });
};

const initializeCamera = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '10.5.5.9',
      path: `/camera/CM?t=${ password }&p=%01`,
      method: 'GET'
    };

    http.request(options, res => {
      if (res.statusCode !== 200) {
        console.error('Unable to initialize camera.');
        return reject();
      }
      res.on('data', () => { });
      res.on('end', () => {
        return takePicture().then(() => {
          return resolve();
        }).catch(() => {
          return reject();
        });
      });
    }).on('error', e => {
      console.error(e);
      reject();
    }).end();
  });
};

let processing = 0;
const mainLoop = () => {
  if (!processing) {
    processing = 1;
    initializeCamera().then(() => {
      console.log('Done!');
      processing = 0;
    }).catch(() => {
      process.exit(1);
    });
  }
};

setInterval(mainLoop, 1000 * 60);