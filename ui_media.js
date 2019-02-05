"use strict";

var formidable = require('formidable');
var fs = require('fs');
var path = require('path');
var mkdirp = require('mkdirp');
var mime = require('mime-types');

module.exports = function (RED) {
    /* Checks if projects are enabled in the settings and create a path ot it if
     * it is. In case projects are disabled, the old path to the lib is created
      */
    if ((RED.settings.get("editorTheme")).projects.enabled) {
      // get the current active project rename
      var currentProject = RED.settings.get("projects").activeProject;
      // create the paths
      var pathDir = path.join(RED.settings.userDir, "projects",String(currentProject), "ui-media", "lib");
      var pathUpload = path.join(RED.settings.userDir, "projects",String(currentProject), "ui-media", "upload");
    } else {
      // create paths without the projects directory
      var pathDir = path.join(RED.settings.userDir, "lib", "ui-media", "lib");
      var pathUpload = path.join(RED.settings.userDir, "lib", "ui-media", "upload");
    }

    mkdirp(pathDir, (err) => {
        if (err) {
            console.log(err);
        }
    });

    mkdirp(pathUpload, (err) => {
        if (err) {
            console.log(err);
        }
    });

    ///------> API

    RED.httpAdmin.post('/uimedia/:category/:id', (req, res) => {

        var error = [];
        var success = [];

        var form = new formidable.IncomingForm();
        form.multiples = true;
        form.uploadDir = pathUpload;

        form.parse(req, function (err, fields, files) {

            var filesUpload = form.openedFiles.length;
            let category = sanitizeInput(req.params.category);
            let name;
            let extension;

            var pathBase = path.join(pathDir, category);

            var controlFiles = filesUpload;

            mkdirp(pathBase, (err) => {

                if (err) {
                    error.push({
                        cod: 500,
                        msg: err
                    });
                    return;
                }

                for (var i = 0; i < filesUpload; i++) {

                    name = files[i].name;

                    if (!(/\.(gif|jpg|jpeg|tiff|png|mp4|webm|ogv)$/i).test(name)) {

                        error.push({
                            cod: 400,
                            msg: 'incompatible files'
                        });

                        controlFiles--;

                        return;
                    }

                    if (controlFiles == 0) {
                        if (error.length > 0) {
                            error.forEach(err => {
                                res.status(err.cod).send(err.msg).end();
                            });

                            return;
                        }https://nodered.org/docs/api/runtime/api#getNode
                        res.status(201).send(success[0]).end();
                    }

                    let oldpath = files[i].path;
                    let newpath = path.join(pathBase, files[i].name);

                    fs.rename(oldpath, newpath, function (err) {

                        controlFiles--;

                        if (err) {

                            error.push({
                                cod: 500,
                                msg: err
                            });
                            return;
                        }

                        let pathExtern = path.join("/", "uimedia", category, name);
                        let reference = category + "/" + name;

                        let obj = {
                            path: pathExtern,
                            ref: reference
                        };

                        success.push(obj);

                        if (controlFiles == 0) {
                            if (error.length > 0) {
                                error.forEach(err => {
                                    res.status(err.cod).send(err.msg).end();
                                });

                                return;
                            }
                            res.status(201).send(success[0]).end();
                        }
                    });
                }
            });
        });
    }); //--> POST /uimedia/'category'/'id'

    /**
     * Creates a category.Returns the list of current categories
     * @returns 200 - JSON with all the categories
     * @returns 500 - system error
     */
    //TODO: use the :category instead of a multpart form post
    RED.httpAdmin.post('/uimedia/:category', (req, res) => {
        console.log(sanitizeInput(req.params.category));
        let dirCategory = path.join(pathDir, sanitizeInput(req.params.category));
        console.log(dirCategory);
        mkdirp(dirCategory, (err) => {
            if (err) {
                res.status(500).send(err);
                return;
            }

            restListCategories(req, res);
        });
    }); //--> POST /uimedia/category/

    /**
     * Returns a list of categories
     * @returns 200 - JSON with all the categories
     * @returns 500 - system error
     */
    function restListCategories(req, res) {

        let responseDone = false

        function doResponse(code, data) {
            if (responseDone) {
                return;
            }
            responseDone = true;

            res.status(code);
            if (data) {
                res.json(data);
            }
            res.end();
        }

        fs.readdir(pathDir, 'utf-8', (err, files) => {

            if (err) {
                doResponse(500, err);
                return;
            }

            var response = [];
            var listCategory = [];

            var numFiles = files.length;

            if (!numFiles) {
                doResponse(200, response);
                return;
            }

            files.forEach(file => {

                var dirFile = path.join(pathDir, file);

                fs.stat(dirFile, (err, stat) => {
                    if (err) {
                        doResponse(500, err);
                        return;
                    }

                    numFiles--;

                    if (stat.isDirectory()) {
                        response.push(file);
                    }

                    if (numFiles === 0) {
                        doResponse(200, response);
                    }
                });
            });
        });
    } //--> GET /uimedia
    RED.httpAdmin.get("/uimedia", restListCategories);

    /**
     * Gets a JSON with the content of a category
     * @returns 200 - JSON with all the medias inside this category
     * @returns 404 - category not found
     * @returns 500 - system error
     */
    RED.httpAdmin.get("/uimedia/:category", (req, res) => {

        let pathCategory = path.join(pathDir, sanitizeInput(req.params.category));

        listFilesDir(pathCategory, (err, files) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.status(404).end();
                } else {
                    res.status(500).json(err).end();
                }
                return;
            }

            res.status(200).json(files).end();
        });

    }); //--> GET /uimedia/:category/medias/

    /**
     * Gets the specified media
     * @returns 200 - the media
     * @returns 404 - media not found
     */
    RED.httpAdmin.get("/uimedia/:category/:id", (req, res) => {

        let id = sanitizeInput(req.params.id);
        let category = sanitizeInput(req.params.category);

        var pathImage = path.join(pathDir, category, id);

        fs.access(pathImage, (err) => {
            if (err) {
                res.status(404).json(err).end();
                return;
            }

            res.setHeader('Content-Type', 'media/*');
            fs.createReadStream(pathImage).pipe(res);
        });

    }); //--> GET /uimedia/'category'/'id'

    /**
     * Deletes an media inside a category
     * @returns 204 - OK
     * @returns 404 - media not found
     * @returns 500 - system error
     */
    RED.httpAdmin.delete("/uimedia/:category/:id", (req, res) => {

        let id = sanitizeInput(req.params.id);
        let category = sanitizeInput(req.params.category);

        var file = path.join(pathDir, category, id);


        fs.unlink(file, (err) => {

            if (err) {
                res.status(404).send(err).end();
                if (err.code === 'ENOENT') {
                    res.status(404).end();
                } else {
                    res.status(500).json(err).end();
                }
                return;
            }

            res.status(204).end();
            return;

        });
    }); //--> DELETE /uimedia/'category'/'id'

    /**
     * Deletes a category, and all medias that it may contain
     * @returns 204 - OK
     * @returns 404 - category not found
     * @returns 500 - system error
     */
    RED.httpAdmin.delete("/uimedia/:category", (req, res) => {

        let categoryPath = path.join(pathDir, sanitizeInput(req.params.category));
        let responseDone = false;

        function doResponse(code, data) {
            if (responseDone) {
                return;
            }
            responseDone = true;

            res.status(code)
            if (data) {
                res.json(data);
            }
            res.end();
        }

        fs.readdir(categoryPath, 'utf-8', (err, files) => {

            if (err) {
                if (err.code === 'ENOENT') {
                    doResponse(404);
                } else {
                    doResponse(500, err);
                }
                return;
            }

            let contFiles = files.length;

            // remove folder if empty
            if (contFiles === 0) {
                fs.rmdir(categoryPath, (err) => {
                    if (err) {
                        console.log("Error: ", err);
                        doResponse(500, err);
                        return;
                    }

                    doResponse(204);
                });
                return;
            }

            files.forEach((file) => {
                let filePath = path.join(categoryPath, file);

                fs.unlink(filePath, (err) => {

                    contFiles--;

                    if (err) {
                        doResponse(500, err);
                        return;
                    }

                    if (contFiles === 0) {
                        fs.rmdir(categoryPath, (err) => {
                            if (err) {
                                doResponse(500, err);
                                return;
                            }

                            doResponse(204);
                        });
                    }
                });
            });
        });
    }); //--> DELETE /uimedia/'category'/'id'

    ///------> API

    // check required configuration
    function checkConfig(node,conf) {
        console.log(conf);
        if (!conf || !conf.hasOwnProperty("group")) {
            node.error(RED._("ui_list.error.no-group"));
            return false;
        }
        return true;
    }

    // holds reference to node-red-dashboard module
    var ui = undefined;

    function ImageNode(config) {
        try {
            // load the necessary module
            if(ui === undefined) {
                ui = RED.require("node-red-dashboard")(RED);
            }
            RED.nodes.createNode(this, config);
            var node = this;
            var tab, elmStyle;
            var link = null,
            layout = 'adjust';

            var group = RED.nodes.getNode(config.group);

            if (!group) {
                return;
            }

            tab = RED.nodes.getNode(group.config.tab);
            if (!tab) {
                return;
            }

            if (!config.width) {
                config.width = group.config.width;

            }

            elmStyle = {
                'width': '100%',
                'height': '100%'
            };

            if (config.category && config.file) {
                link = '/uimedia/' + config.category + '/' + config.file;
            }

            // create the widget's HTML snippet
            var rawHTML = String.raw`<div class="bgimg"></div>`;

            if (config.layout) {
                layout = config.layout;
            }

            /**
	           * Check for that we have a config instance and that our config instance has a group selected, otherwise report an error
             * @param {string} config - configs with the layout to be set
          	 * @param {string} path - the layout configuration fo the media to be shown
          	 */
            function processImageLayout(config, path) {
                var HTML = undefined;
                var auto = false;
                // create a div name based on the path
                var div_name = path.split(".")[0];
                div_name.concat("-div");

                /* to-do: this is a workaround, try to fix it with css only */
                if ((config.width == '0') && (config.height == '0')) {
                  auto = true;
                }

                var clickScript = String.raw `
                <script>
                      var current_scope = scope;

                      function getImageXY (event) {
                        var properties = {
                          clientX: event.clientX,
                          clientY: event.clientY,
                          screenX: event.screenX,
                          screenY: event.screenY,
                          layoutX: event.layoutX,
                          layoutY: event.layoutY,
                          pageX: event.pageX,
                          pageY: event.pageY,
                          offsetX: event.offsetX,
                          offsetY: event.offsetY
                        };
                        var msg = {
                          payload : properties
                        };
                          current_scope.send(msg);
                      }
                      var imageDiv = document.getElementById("${div_name}");
                      imageDiv.onclick = getImageXY;

                      // workaround mentioned earlier
                      // size is set to auto, width == height
                      if (${auto}) {
                        var parent = document.getElementById("${div_name}").parentElement;
                        parent.style.height = parent.style.width;
                      }
                </script>
                `;

                switch (config.layout) {

                    case 'adjust': {
                        HTML = String.raw`
                        <div id="${div_name}" style="width:100%; height: auto;max-height: 100%;margin: 0, auto">
                           <img src="${path}" align="middle" width="100%">
                        </div>`;
                        break;
                    }

                    case 'center': {
                        HTML = String.raw`
                        <div id="${div_name}" style="
                        background-image: url('${path}');
                        background-size:'';
                        background-position: center;
                        background-repeat: no-repeat;
                        width: 100%;
                        height: 100%"></div>`;
                        break;
                    }

                    case 'expand': {
                        HTML = String.raw`
                        <div id="${div_name}" style="
                        background-image: url('${path}');
                        background-size:'cover';
                        background-position: center;
                        background-repeat: no-repeat;
                        width: 100%;
                        height: 100%"></div>`;
                        break;
                    }

                    case 'side': {
                        HTML = String.raw`
                        <div id="${div_name}" style="
                        background-image: url('${path}');
                        background-size:'';
                        background-position: '';
                        background-repeat: nrepeat;
                        width: 100%;
                        height: 100%"></div>`;
                        break;
                    }

                    default: {
                        HTML = String.raw`
                        <div id="${div_name}" style="width:100%; height: auto;max-height: 100%;margin: 0, auto">
                           <img src="${path}" align="middle" width="100%">
                        </div>`;
                        node.warn("Invalid Layout - " + layout);
                        break;
                    }
                }
                return HTML.concat(clickScript);
            }

            /**
	           * Check for that we have a config instance and that our config instance has a group selected, otherwise report an error
          	 * @param {string} path - the layout configuration fo the media to be shown
             * @param {boolean} controls - 'true' if controls must be shown, 'false' if mustn't
             * @param {boolean} onstart - 'true' if video must star when load , 'false' if mustn't
             * @param {boolean} loop - 'true' if video must loop when finilshed, 'false' if mustn't
          	 */
            function processVideoLayout(path, controls, onstart, loop) {
                var controls_string = "";
                var onstart_string = "";
                var loop_string = "";

                if (controls) {controls_string = " controls"};
                if (onstart) {onstart_string = " autoplay"};
                if (loop) {loop_string = " loop=\"true\""};

                // create a div name based on the path
                var video_name = path.split(".")[0];
                video_name.concat("-video");
                var HTML = String.raw`
                <script>
                  // To play/pause the video we must watch for the right msgs
                  scope.$watch('msg', function(newMsg, oldMsg, scope){
                    var media = document.getElementById("${video_name}");
                    if (newMsg.play) {
                      media.play();
                    } else {
                      media.pause();
                    }
                  });
                </script>
                <style>
                  video{
                    width: 100%;
                    height: auto;
                    max-height: 98%;
                    position: relative;
                    top: 50%;
                    transform: translateY(-50%);
                  }
                </style>
                <video id="${video_name}" src="${path}" ${controls_string}
                ${loop_string} ${onstart_string} ></video>
                 `;

                return HTML;
            }

            /**
	           * Check for that we have a config instance and that our config instance has a group selected, otherwise report an error
          	 * @param {object} url - The file path
          	 * @returns {string} 'img' if the file has a image type and 'video' if the file has a video type
          	 */
             function getFileType (url) {
               var type = String(mime.lookup(url));

               if (type.includes("image")){
                 return "image";
               }else if (type.includes("video")) {
                 return "video";
               }
             }

             /**
 	           * Check for that we have a config instance and that our config instance has a group selected, otherwise report an error
           	 * @param {object} path - The file path
             * @param {string} extension - The file's extension
             * @param {string} layout - The image layout to be set
             * @returns {string} Widget's HTML snippet
           	 */
             function HTML (path, type, config) {
               var raw;

               if ((/(image)$/i).test(type)) {
                    raw = processImageLayout(config, path);
               } else if ((/(video)$/i).test(type)) {
                    raw =  processVideoLayout(path, config.showcontrols, config.onstart, config.loop);
               }
               return raw;
             }

             // creates the widget
             var done = ui.addWidget({
                // define the widger properties
                node: node,
                width: config.width,
                height: config.height,
                format: rawHTML,
                templateScope: "local",
                group: config.group,
                emitOnlyNewValues: false,
                forwardInputMessages: false,
                // define the functions of the widget
                convertBack: function (value) {
                    return value;
                },
                beforeEmit: function (msg, value){
                    // process current layout
                    if (msg.layout !== undefined) {
                        layout = msg.layout;
                    }
                    // process current media
                    if (msg.src !== undefined) {
                        link = msg.src;
                    }else if (msg.payload !== undefined) {
                        if (typeof msg.payload == 'string') {
                            link = msg.payload ? '/uimedia/' + msg.payload : '';
                        } else if (msg.payload.category && msg.payload.name) {
                            link = '/uimedia/' + msg.payload.category + '/' + msg.payload.name;
                        } else if (msg.payload.onstart || msg.payload.loop || msg.payload.controls) {
                            config.onstart = JSON.parse(msg.payload.onstart);
                            config.loop = JSON.parse(msg.payload.loop);
                            config.showcontrols = JSON.parse(msg.payload.controls);
                        }
                    }
                    rawHTML = HTML(link, getFileType(link), config);
                    return {
                        format: rawHTML,
                        msg: msg
                    }
                },
                beforeSend: function (msg, orig) {
                    if (orig) {
                        // if the payload contains the desired hasOwnProperty
                        if ('clientX' in orig.msg.payload){
                          return orig.msg;
                        }
                    }
                },
                initController: function ($scope, events) {
                    $scope.value = false;
                    $scope.click = function (val) {
                        $scope.send({payload: val});
                    };
                }

            });
             node.emit('input', {}); //triggers the configured media
             node.on("close", done);
        }
        catch (e) {
            console.log(e);
        }
    }
    RED.nodes.registerType("ui_media", ImageNode);
};


// list the files inside a directory
function listFilesDir(pathDir, cb) {

    let callbackDone = false;

    function doCallback(err, data) {
        if (callbackDone) {
            return;
        }
        callbackDone = true;
        cb(err, data);
    }

    let medias = [];

    fs.readdir(pathDir, 'utf-8', (err, files) => {

        if (err) {
            doCallback(err, null);
            return;
        }

        let countFiles = files.length;

        if (countFiles === 0) {
            doCallback(null, medias);
            return;
        }

        files.forEach(file => {

            fs.stat(path.join(pathDir, file), (err, stat) => {

                countFiles--;

                if (err) {
                    doCallback(err, null);
                    return;
                }

                if (!stat.isDirectory()) {
                    medias.push(file);
                }

                if (countFiles === 0) {
                    doCallback(null, medias);
                }

            });
        });
    });
}

// inspired on https://github.com/parshap/node-sanitize-filename
const sanitizeInput = (function (str) {
    const illegalRe = /[\/\?<>\\:\*\|":]/g;
    const controlRe = /[\x00-\x1f\x80-\x9f]/g;
    const reservedRe = /^\.+$/;
    const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
    const windowsTrailingRe = /[\. ]+$/;

    const replacement = '_';

    //return function sanitizeInput(str) {

        return (str || "")
            .replace(illegalRe, replacement)
            .replace(controlRe, replacement)
            .replace(reservedRe, replacement)
            .replace(windowsReservedRe, replacement)
            .replace(windowsTrailingRe, replacement);
    //}
});
