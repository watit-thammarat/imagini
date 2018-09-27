const express = require('express');
const sharp = require('sharp');
const bodyparser = require('body-parser');
const path = require('path');
const rethinkdb = require('rethinkdb');

const settings = require('./settings.json');

const app = express();

rethinkdb.connect(
  settings.db,
  (err, db) => {
    if (err) throw err;
    console.log('db: ready');

    rethinkdb.tableList().run(db, (err, tables) => {
      if (err) throw err;

      if (!tables.includes('images')) {
        rethinkdb.tableCreate('images').run(db);
      }
    });

    app.param('image', (req, res, next, image) => {
      if (!image.match(/\.(png|jpg)$/i)) {
        return res.status(403).end();
      }
      rethinkdb
        .table('images')
        .filter({
          name: image
        })
        .limit(1)
        .run(db, (err, images) => {
          if (err) return res.status(404).end();
          images.toArray((err, images) => {
            if (err) return res.status(500).end();
            if (!images.length) return res.status(404).end();
            req.image = images[0];
            return next();
          });
        });
    });

    app.head('/uploads/:image', (req, res) => {
      return res.status(200).end();
    });

    app.get('/uploads/:image', (req, res) => {
      const image = sharp(req.image.data);
      const width = +req.query.width;
      const height = +req.query.height;
      const blur = +req.query.blur;
      const sharpen = +req.query.sharpen;
      const greyscale = ['y', 'yes', '1', 'on'].includes(req.query.greyscale);
      const flip = ['y', 'yes', '1', 'on'].includes(req.query.flip);
      const flop = ['y', 'yes', '1', 'on'].includes(req.query.flop);
      if (width > 0 && height > 0) {
        image.ignoreAspectRatio();
      }
      if (width > 0 || height > 0) {
        image.resize(width || null, height || null);
      }
      if (flip) image.flip();
      if (flop) image.flop();
      if (blur > 0) image.blur(blur);
      if (sharpen) image.sharpen(sharpen);
      if (greyscale) image.greyscale();

      rethinkdb
        .table('images')
        .get(req.image.id)
        .update({
          date_used: Date.now()
        })
        .run(db);

      res.setHeader(
        'Content-Type',
        'image/' + path.extname(req.image.name).substr(1)
      );
      image.pipe(res);
    });

    app.delete('/uploads/:image', (req, res) => {
      rethinkdb
        .table('images')
        .get(req.image.id)
        .delete()
        .run(db, err => {
          return res.status(err ? 500 : 200).end();
        });
    });

    app.post(
      '/uploads/:name',
      bodyparser.raw({
        limit: '10mb',
        type: 'image/*'
      }),
      (req, res) => {
        rethinkdb
          .table('images')
          .insert({
            name: req.params.name,
            size: req.body.length,
            data: req.body
          })
          .run(db, err => {
            if (err) {
              return res.send({ status: 'error', code: err.code });
            }
            res.send({ status: 'ok', size: req.body.length });
          });
      }
    );

    app.get('/stats', (req, res) => {
      console.log('==> xxx');
      let uptime = process.uptime();
      rethinkdb
        .table('images')
        .count()
        .run(db, (err, total) => {
          if (err) {
            console.error(err);
            return res.status(500).end();
          }
          rethinkdb
            .table('images')
            .sum('size')
            .run(db, (err, size) => {
              if (err) {
                console.error(err);
                return res.status(500).end();
              }
              rethinkdb
                .table('images')
                .max('date_used')
                .run(db, (err, last_created) => {
                  if (err) {
                    console.error(err);
                    return res.status(500).end();
                  }
                  last_created = last_created
                    ? new Date(last_created.date_created)
                    : null;
                  return res.send({ total, size, last_created, uptime });
                });
            });
        });
    });

    setInterval(() => {
      let expiration = Date.now() - 30 * 86400 * 1000;
      rethinkdb
        .table('images')
        .filter(image => {
          return image('date_used').lt(expiration);
        })
        .delete()
        .run(db);
    }, 3600 * 1000);

    app.listen(3000, () => {
      console.log('app: ready');
    });
  }
);
