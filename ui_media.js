//@ts-check
/*
   Copyright 2016-2020 ST-One Ltda.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

"use strict";

var formidable = require('formidable');
var fs = require('fs');
var path = require('path');
var urlPath = path.posix;
var mkdirp = require('mkdirp');
var mime = require('mime-types');

module.exports = function (RED) {

    var pathDir, pathUpload, httpRoot;

    /**
     * Checks if projects are enabled in the settings and create a path for it if
     * it is. In case projects are disabled, the old path to the lib is created
     */
    function updateDirs() {
        let editorTheme = RED.settings.get("editorTheme");
        let projects = RED.settings.get("projects");
        let userDir = RED.settings.userDir;

        if (editorTheme && projects && editorTheme.projects && editorTheme.projects.enabled && projects.activeProject) {
            // create the paths
            pathDir = path.resolve(userDir, "projects", String(projects.activeProject), "ui-media", "lib");
            pathUpload = path.resolve(userDir, "projects", String(projects.activeProject), "ui-media", "upload");
        } else {
            // create paths without the projects directory
            pathDir = path.resolve(userDir, "lib", "ui-media", "lib");
            pathUpload = path.resolve(userDir, "lib", "ui-media", "upload");
        }

        httpRoot = RED.settings.get('httpAdminRoot') || RED.settings.get('httpRoot') || '/';

        mkdirp(pathDir).catch((err) => {
            if (err) {
                RED.log.error(`Could not create library directory [${pathDir}]: ${err}`);
            }
        });

        mkdirp(pathUpload).catch((err) => {
            if (err) {
                RED.log.error(`Could not create upload directory [${pathUpload}]: ${err}`);
            }
        });
    }

    // initialize directories with current project settings
    updateDirs();
    // Subscribe to a project change
    if (RED.events) {
        RED.events.on('runtime-event', evt => {
            if (evt && evt.id === 'project-update' && evt.payload.action == 'loaded') {
                // Update directories when loading a project only
                updateDirs();
            }
        })
    }


    ///------> API

    function uploadMedia(req, res) {

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

            mkdirp(pathBase).then(() => {

                for (var i = 0; i < filesUpload; i++) {

                    name = files[i].name;

                    if (!(/\.(gif|jpg|jpeg|tiff|png|svg|mp4|webm|ogv)$/i).test(name)) {

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
                        } //https://nodered.org/docs/api/runtime/api#getNode
                        res.status(201).send(success[0]).end();
                    }

                    let oldpath = files[i].path;
                    let newpath = path.join(pathBase, sanitizeInput(files[i].name));

                    fs.rename(oldpath, newpath, function (err) {

                        controlFiles--;

                        if (err) {

                            error.push({
                                cod: 500,
                                msg: err
                            });
                            return;
                        }

                        let pathExtern = urlPath.join(httpRoot, 'uimedia', category, name);
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
            }).catch(err => {
                res.status(500).send(err).end();
            });
        });
    }

    /**
     * Creates a category and returns the list of current categories
     */
    function createCategory(req, res) {
        let dirCategory = path.join(pathDir, sanitizeInput(req.params.category));
        mkdirp(dirCategory).then(() => {
            restListCategories(req, res);
        }).catch(err => {
            res.status(500).send(err);
        });

    }

    /**
     * Returns a list of categories
     */
    function restListCategories(req, res) {

        let responseDone = false

        function doResponse(code, data) {
            if (responseDone) return;
            responseDone = true;

            res.status(code).json(data).end();
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
    }

    /**
     * Gets a JSON with the content of a category
     */
    function listCategoryContents(req, res) {
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
    }

    /**
     * Gets the specified media
     */
    function getMedia(req, res) {
        let id = sanitizeInput(req.params.id);
        let category = sanitizeInput(req.params.category);

        var pathImage = path.join(pathDir, category, id);

        fs.access(pathImage, (err) => {
            if (err) {
                res.status(404).json(err).end();
                return;
            }

            try {
                res.sendFile(pathImage);
            } catch (e) {
                /* handles errors of sendFile "gracefully" instead of 
                potentially crashing node-red */
                res.status(500).json(e).end();
            }
        });
    }

    /**
     * Deletes an media inside a category
     */
    function deleteMedia(req, res) {
        let id = sanitizeInput(req.params.id);
        let category = sanitizeInput(req.params.category);

        var file = path.join(pathDir, category, id);

        fs.unlink(file, (err) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.status(404).end();
                } else {
                    res.status(500).json(err).end();
                }
            } else {
                res.status(204).end();
            }
        });
    }

    /**
     * Deletes a category, and all medias that it may contain
     * Status codes: 204 - OK, 404 - category not found
     * 500 - system error
     */
    function deleteCategory(req, res) {
        let categoryPath = path.join(pathDir, sanitizeInput(req.params.category));
        let responseDone = false;

        function doResponse(code, data) {
            if (responseDone) return;
            responseDone = true;

            res.status(code).end(data);
        }

        function removeFolder() {
            fs.rmdir(categoryPath, (err) => {
                if (err) {
                    RED.log.error("Error removing category: " + err);
                    doResponse(500, err);
                } else {
                    doResponse(204);
                }
            });
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
            if (contFiles === 0) return removeFolder();

            files.forEach(file => {
                fs.unlink(path.join(categoryPath, file), err => {

                    contFiles--;
                    if (err) return doResponse(500, err);

                    if (contFiles === 0) removeFolder();
                });
            });
        });
    }

    // "public" endpoint
    RED.httpAdmin.get('/uimedia/:category/:id', getMedia);
    // "private" endpoints that need permissions
    RED.httpAdmin.post('/uimedia/:category/:id', RED.auth.needsPermission('ui.ui_media'), uploadMedia);
    RED.httpAdmin.post('/uimedia/:category', RED.auth.needsPermission('ui.ui_media'), createCategory);
    RED.httpAdmin.get('/uimedia', RED.auth.needsPermission('ui.ui_media'), restListCategories);
    RED.httpAdmin.get('/uimedia/:category', RED.auth.needsPermission('ui.ui_media'), listCategoryContents);
    RED.httpAdmin.delete('/uimedia/:category/:id', RED.auth.needsPermission('ui.ui_media'), deleteMedia);
    RED.httpAdmin.delete('/uimedia/:category', RED.auth.needsPermission('ui.ui_media'), deleteCategory);

    ///------> API

    // holds reference to node-red-dashboard module
    var ui = undefined;

    /**
     * 
     * @param {object} config 
     */
    function ImageNode(config) {

        // load the necessary module
        if (ui === undefined) {
            ui = RED.require("node-red-dashboard")(RED);
        }
        RED.nodes.createNode(this, config);

        let node = this;
        let group, tab, link;
        let layout = config.layout || 'adjust';
        // whether we need to re-render/update the HTML template
        let updateHTML = true;

        group = RED.nodes.getNode(config.group);
        if (!group) {
            node.error(RED._("ui_media.error.no-config"));
            return;
        }

        tab = RED.nodes.getNode(group.config.tab);
        if (!tab) {
            node.error(RED._("ui_media.error.no-config"));
            return;
        }

        if (config.width == '0') {
            config.width = group.config.width;
            config.height = group.config.width;
        }

        if (config.category && config.file) {
            link = urlPath.join(httpRoot, 'uimedia', config.category, config.file);
        }

        /**
         * Check for that we have a config instance and that our config instance has a group selected, otherwise report an error
         * @param {object} config - configs with the layout to be set
         * @param {string} path - the layout configuration fo the media to be shown
         */
        function processImageLayout(config, path) {
            var HTML = undefined;
            var auto = false;
            // create a div name based on the path
            var d = new Date();
            var div_name = String(d.getTime());
            div_name.concat("-div");

            /* to-do: this is a workaround, try to fix it with css only */
            if ((config.width == '0') && (config.height == '0')) {
                auto = true;
            }

            var clickScript = String.raw`
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
                </script>
                `;

            switch (config.layout) {

                case 'adjust': {
                    HTML = String.raw`
                        <div id="${div_name}" style="width:100%; height: 100%;max-height: 100%;display: inline-block;margin: 0 auto;" title="${config.tooltip}">
                           <img src="${path}" align="middle" style="width: auto;
                           height:auto;
                           max-height: 100%;
                           max-width: 100%;
                           display:block">
                        </div>`;
                    break;
                }

                case 'center': {
                    HTML = String.raw`
                        <div id="${div_name}" style="
                        background-image: url('${path}');
                        background-size: 100%;
                        background-position: center;
                        background-repeat: no-repeat;
                        width: 100%;
                        height: 100%;
                        "
			title="${config.tooltip}"
			></div>`;
                    /*HTML = String.raw`
                    <div id="${div_name}" style="overflow:hidden;width:100%; height: 100%;max-height: 100%;display: inline-block;margin: 0, auto;">
                        <img src="${path}" style="
                        position: relative;
                        top: 50%;
                        transform: translateY(-50%);
                        ">
                    </div>`;*/
                    break;
                }

                case 'expand': {
                    HTML = String.raw`
                        <div id="${div_name}" style="
                        background-image: url('${path}');
                        background-size: cover;
                        background-position: center;
                        background-repeat: no-repeat;
                        width: 100%;
                        height: 100%"
			title="${config.tooltip}"
			></div>`;
                    break;
                }

                case 'side': {
                    HTML = String.raw`
                        <div id="${div_name}" style="
                        background-image: url('${path}');
                        background-size:'';
                        background-position: '';
                        background-repeat: repeat;
                        width: 100%;
                        height: 100%"
		        title="${config.tooltip}"
			></div>`;
                    break;
                }

                default: {
                    HTML = String.raw`
                        <div id="${div_name}" style="width:100%; height: auto;max-height: 100%;margin: 0, auto" title="${config.tooltip}">

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
         * @param {boolean} onstart - 'true' if video must start when load , 'false' if mustn't
         * @param {boolean} loop - 'true' if video must loop when finilshed, 'false' if mustn't
         * @param {boolean} muted whether the video should start muted
         */
        function processVideoLayout(path, controls, onstart, loop, muted) {
            var controls_string = "";
            var onstart_string = "";
            var loop_string = "";
            var muted_string = "";

            if (controls) { controls_string = " controls" };
            if (onstart) { onstart_string = " autoplay" };
            if (loop) { loop_string = " loop=\"true\"" };
            if (muted) { muted_string = " muted" };

            var video_name = `video_${(Math.random() * 0xffffffff).toString(16)}`
            var HTML = String.raw`
                <script>
                    // To play/pause the video we must watch for the right msgs
                    scope.$watch('msg', function(newMsg, oldMsg, scope){
                        var media = document.getElementById("${video_name}");
                        if (newMsg.hasOwnProperty('play')){
                            newMsg.play ? media.play() : media.pause();
                        }
                        if (newMsg.hasOwnProperty('mute')){
                            media.muted = newMsg.mute;
                        }
                        if (newMsg.hasOwnProperty('loop')){
                            media.loop = newMsg.loop;
                        }
                        if (newMsg.hasOwnProperty('controls')){
                            media.controls = newMsg.controls;
                        }
                    });
                </script>

                <video id="${video_name}" 
                    src="${path}" 
                    style="width: 100%; height: auto; max-height: 98%; position: relative; top: 50%; transform: translateY(-50%);"
                    ${controls_string} ${loop_string} ${onstart_string} ${muted_string}>
                </video>`;

            return HTML;
        }

        /**
         * Check for that we have a config instance and that our config instance has a group selected, otherwise report an error
         * @param {object} url - The file path
         * @returns {string} 'img' if the file has a image type and 'video' if the file has a video type
         */
        function getFileType(url) {
            var type = String(mime.lookup(url));

            if (type.includes("image")) {
                return "image";
            } else if (type.includes("video")) {
                return "video";
            }
        }

        /**
         * Check for that we have a config instance and that our config instance has a group selected, otherwise report an error
         * @param {object} config - The file path
         * @param {string} path - The file's extension
         * @param {string} type - The image layout to be set
         * @returns {string} Widget's HTML snippet
         */
        function HTML(path, type, config) {
            var raw;

            if ((/(image)$/i).test(type)) {
                raw = processImageLayout(config, path);
            } else if ((/(video)$/i).test(type)) {
                raw = processVideoLayout(path, config.showcontrols, config.onstart, config.loop, config.muted);
            }

            return raw;
        }

        // creates the widget
        var done = ui.addWidget({
            // define the widger properties
            node: node,
            width: config.width,
            height: config.height,
            format: '<div class="bgimg"></div>',
            templateScope: "local",
            group: config.group,
            order: config.order,
            emitOnlyNewValues: false,
            forwardInputMessages: false,
            // define the functions of the widget
            convertBack: function (value) {
                return value;
            },
            beforeEmit: function (msg, value) {
                let retVal = { msg };

                // process current layout
                if (msg.layout !== undefined) {
                    layout = msg.layout;
                    updateHTML = true;
                }

                // process current media
                if (typeof msg.src === 'string') {
                    updateHTML = true;

                    link = msg.src;
                } else if (msg.payload) {
                    updateHTML = true;

                    if (typeof msg.payload == 'string') {
                        link = msg.payload ? urlPath.join(httpRoot, 'uimedia', msg.payload) : '';
                    } else if (Buffer.isBuffer(msg.payload)) {
                        // we need the mimetype to be explicitly defined when the payload is a Buffer
                        if (typeof msg.mimetype !== 'string') {
                            node.error(RED._("ui_media.error.no-mimetype"));
                            return;
                        }
                        link = `data:${msg.mimetype};base64,${msg.payload.toString('base64')}`;
                    } else if (msg.payload.category && msg.payload.name) {
                        link = urlPath.join(httpRoot, 'uimedia', msg.payload.category, msg.payload.name);
                    }

                    // process media configuration
                    if (msg.payload.onstart !== undefined) config.onstart = !!JSON.parse(msg.payload.onstart);
                    if (msg.payload.loop !== undefined) config.loop = !!JSON.parse(msg.payload.loop);
                    if (msg.payload.controls !== undefined) config.showcontrols = !!JSON.parse(msg.payload.controls);
                    if (msg.payload.muted !== undefined) config.muted = !!JSON.parse(msg.payload.muted);
                }

                if (updateHTML) {
                    let fileType = (typeof msg.mimetype === 'string') ? msg.mimetype.split('/')[0] : getFileType(link);
                    if (link && !fileType) node.error(RED._("ui_media.error.undefined-media-type"));

                    retVal.format = HTML(link, fileType, config);
                    updateHTML = false;
                }

                return retVal;
            },
            beforeSend: function (msg, orig) {
                if (orig) {
                    // if the payload contains the desired hasOwnProperty
                    if ('clientX' in orig.msg.payload) {
                        return orig.msg;
                    }
                }
            },
            initController: function ($scope, events) {
                $scope.value = false;
                $scope.click = function (val) {
                    $scope.send({ payload: val });
                };
            }

        });
        node.emit('input', {}); //triggers the configured media
        node.on("close", done);
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
