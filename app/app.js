const smartcard = require('smartcard');
const electron = require('electron');
const fs = require('fs-extra');
const sqlite3 = require('sqlite3');
const eapp = electron.remote.app;
const Devices = smartcard.Devices;
const devices = new Devices();
let currentDevices = [];
let db = new sqlite3.Database('AOFCheckDB.db', function (error) {
    if (error != null) console.warn("Failed to initialize database :" + error);
    else {
        db.exec(
            "CREATE TABLE if not exists StudentInfo      " +
            "(id     TEXT PRIMARY KEY UNIQUE NOT NULL," +
            " firstName TEXT                            ," +
            " lastName  TEXT                            ," +
            " rfid      TEXT                            ," +
            " dorm      TEXT                           );" +
            "CREATE TABLE if not exists StudentCheck     " +
            "(id     TEXT                    NOT NULL," +
            " eventId   TEXT                    NOT NULL," +
            " inTime    TEXT                            ," +
            " outTime   TEXT                            ," +
            " upload  TEXT                              ," +
            " PRIMARY KEY (id, eventId)             );" +
            "CREATE TABLE if not exists StudentReg       " +
            "(id     TEXT PRIMARY KEY UNIQUE NOT NULL," +
            " rfid      TEXT                           );" +
            "CREATE TABLE if not exists Events           " +
            "(eventId   TEXT PRIMARY KEY UNIQUE NOT NULL," +
            " eventName TEXT                            ," +
            " eventTime TEXT                            ," +
            " status    TEXT                           ) ",
            function (error) {
                if (error != null) console.warn("Failed to create table: " + error);
            });
    }
});
const photoPath = eapp.getPath('appData') + '/student-check-electron-angular/pics';
///Users/liupeiqi/Library/Application Support/student-check-electron-angular/pics
const domain = "http://hn2.guardiantech.com.cn:10492/v2/";
const placeHolderPic = 'http://placekitten.com/300/450';

let app = angular.module("studentCheck", ['ngRoute', 'routeStyles'], function ($httpProvider) {
    $httpProvider.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded;charset=utf-8';
    let param = function (obj) {
        let query = '', name, value, fullSubName, subName, subValue, innerObj, i;

        for (name in obj) {
            value = obj[name];

            if (value instanceof Array) {
                for (i = 0; i < value.length; ++i) {
                    subValue = value[i];
                    fullSubName = name + '[' + i + ']';
                    innerObj = {};
                    innerObj[fullSubName] = subValue;
                    query += param(innerObj) + '&';
                }
            }
            else if (value instanceof Object) {
                for (subName in value) {
                    subValue = value[subName];
                    fullSubName = name + '[' + subName + ']';
                    innerObj = {};
                    innerObj[fullSubName] = subValue;
                    query += param(innerObj) + '&';
                }
            }
            else if (value !== undefined && value !== null)
                query += encodeURIComponent(name) + '=' + encodeURIComponent(value) + '&';
        }

        return query.length ? query.substr(0, query.length - 1) : query;
    };
    // Override $http service's default transformRequest
    $httpProvider.defaults.transformRequest = [function (data) {
        return angular.isObject(data) && String(data) !== '[object File]' ? param(data) : data;
    }];
});

app.run(function($rootScope) {
    let registerDevices = function (event) {
        currentDevices = event.devices;
        currentDevices.forEach(function (device) {
            device.on('card-inserted', event => {
                let card = event.card;
                console.log(`Card '${card.getAtr()}' inserted into '${card.device}'`);
                $rootScope.$broadcast('card-attach',card.getAtr());
            });
            device.on('card-removed', event => {
            });
            device.on('error', event => {
                console.error("Card Reader Error: " + event);
            });
        });
    };

    devices.on('device-activated', event => {
        console.log("Reader added :" + event.device);
        registerDevices(event);
    });

    devices.on('device-deactivated', event => {
        console.log("Reader removed :" + event.device);
        registerDevices(event);
    });

    $rootScope.isLoggedIn = false;
});

app.factory("session", function () {
    return {
        get: function (key) {
            return window.sessionStorage.getItem(key);
        },
        set: function (key, value) {
            window.sessionStorage.setItem(key, value);
        },
        remove: function (key) {
            window.sessionStorage.removeItem(key);
        },
        clear: function () {
            window.sessionStorage.clear();
        }
    };
});
app.factory('httpInterceptor', ['$q', '$injector', 'session', function ($q, $injector, session) {
    let httpInterceptor = {
        'responseError': function (response) {
            return $q.reject(response);
        },
        'response': function (response) {
            return response;
        },
        'request': function (config) {
            if (session.get("token") !== undefined && session.get("token") != "") {
                config.headers['Authorization'] = "Bearer " + session.get("token");
            }
            return config;
        },
        'requestError': function (config) {
            return $q.reject(config);
        }
    };
    return httpInterceptor;
}]);
//Network & DB
app.factory('syncManager', function ($http) {
    return {
        downloadStudentInfo: function (callback) {
            $http.get(domain + 'api/student/all').then(function (result) {
                db.serialize(function () {
                    db.run("BEGIN TRANSACTION");
                    // db.run("DELETE FROM `StudentInfo`");
                    let stmt = db.prepare("INSERT OR REPLACE INTO `StudentInfo` ('id','firstName','lastName','rfid','dorm') VALUES (?,?,?,?,?)");
                    for (let i = 0; i < result.data.students.length; i++) {
                        let student = result.data.students[i];
                        stmt.run([student.studentId, student.firstName, student.lastName, student.rfid, student.dorm]);
                    }
                    stmt.finalize();
                    db.run("COMMIT");
                    callback(true);
                });
            }, function (error) {
                alert("Download Students Error!");
                callback(false);
            });
        },
        /**
         * Download event list
         * @param local write to DB if true
         * @param callback return events while succeed, return null if failed
         */
        downloadEvents: function (local, callback) {
            $http.get(domain + '/api/event/list').then(function (result) {
                if (local){
                    db.serialize(function () {
                        db.run("BEGIN TRANSACTION");
                        // db.run("DELETE FROM `Events`");
                        let stmt = db.prepare("INSERT OR REPLACE INTO `Events` ('eventId','eventName','eventTime','status') VALUES (?,?,?,?)");
                        for (let i = 0; i < result.data.events.length; i++) {
                            let event = result.data.events[i];
                            if (event.eventStatus != 2) {
                                stmt.run([event.eventId, event.eventName, event.eventTime, event.eventStatus]);
                            }
                        }
                        stmt.finalize();
                        db.run("COMMIT");
                    });
                }
                callback(result.data.events);
            }, function (error) {
                alert("Download Events Error!");
                callback(null);
            });
        },
        readUncompletedEvents: function (callback) {
            db.all("SELECT * FROM `Events` WHERE `status` <> 2", [], function (err, rows) {
                if (err == null) {
                    let events = [];
                    rows.forEach(function (row) {
                        events.push(
                            {
                                eventId: row.eventId,
                                eventName: row.eventName,
                                eventTime: row.eventTime,
                                eventStatus: row.status
                            }
                        );
                    });
                    callback(events);
                } else {
                    console.warn("error:" + err);
                }
            });
        },
        /**
         * Download event detail (students)
         * @param local write to DB if true
         * @param eventId Event ID
         * @param callback return students while succeed, return null if failed
         */
        downloadEventStudents: function (local, eventId, callback) {
            $http.get(domain + 'api/event/' + eventId + '/detail').then(function (result) {
                if (local){
                    //todo:offline
                }
                callback(result.data.students);
            }, function (error) {
                alert("Download Student @ " + eventId + " Error!");
                callback(null);
            });
        },
        downloadPics: function (callback){
            console.log(photoPath);
            fs.ensureDirSync(photoPath);
            db.each("SELECT * FROM `StudentInfo`",[],function (err, row) {
                    $http.get(domain + '/api/student/'+ row.id +'/image',{responseType: 'arraybuffer'}).then(function (result) {
                        let f = fs.createWriteStream(photoPath + '/' + row.id + '.jpg');
                        f.write(Buffer.from(result.data),function (err, written, string) {
                            if (err) console.warn(err.code);
                            // else console.log('write file succeed @' + row.id);
                            f.close();
                        });
                        callback(true,null);
                    }, function (error) {
                        console.warn('http error occur @' + row.id + ' :' + error);
                        callback(true,null);
                    });
                },
                function (err, rowN) {
                    callback(false,rowN);
                });
        },

        /**
         * Upload add students to server
         * @param students Array of students, need at least id, checkinTime, checkoutTime
         * @param eventId Event ID
         * @param callback true if succeed, false if failed;
         */
        uploadAddStudent: function (students, eventId, callback) {
            let addArr = [];
            students.forEach(function (stu) {
                addArr.push({
                    id: stu.id.toString(),
                    checkin: stu.inTime.toString(),
                    checkout: stu.outTime.toString()
                });
            });
            $http.post(domain + 'api/event/' + eventId + '/add', {
                data: JSON.stringify({
                    add: addArr
                })
            }).then(function (suc) {
                callback(true);
            }, function (err) {
                callback(false);
            });

        },
        /**
         * Upload remove students to server
         * @param students Array of students, need at least id
         * @param eventId Event ID
         * @param callback true if succeed, false if failed;
         */
        uploadRemoveStudent: function (students, eventId, callback) {
            let rmArr = [];
            students.forEach(function (stu) {
                rmArr.push(stu.id.toString());
            });
            $http.post(domain + 'api/event/' + eventId + '/remove', {data: JSON.stringify({remove: rmArr})}).then(function (suc) {
                callback(true);
            }, function (err) {
                callback(false);
            });
        },
        uploadAddEvent: function (eventName, callback) {
            $http.post(domain + 'api/event/add', {eventName: eventName}).then(function (suc) {
                callback(suc);
            }, function (err) {
                callback(null);
            });
        },
        uploadCompleteEvent: function (local, eventId, callback) {
            $http.post(domain + 'api/event/' + eventId + '/complete', {}).then(function (suc) {
                if (local){
                    db.run("UPDATE `Events` SET `status` = ? WHERE `eventId` = ?", [2, eventId],function(err){
                        if (err) {
                            console.warn('uploadCompleteEvent DB error:' + err);
                        }
                    });
                }
                callback(true);
            }, function (err) {
                callback(false);
            });
        },
        uploadRegister: function (id, rfid, callback) {
            $http.post(domain + 'api/student/'+id+'/update',{rfid:rfid}).then(function(suc){
                db.run('UPDATE `StudentInfo` SET `rfid` = ? WHERE id = ?',[rfid,id],function(err){
                    if (err){
                        console.warn('uploadRegister DB error:'+err);
                    }
                });
                callback(true);
            },function(err){
                callback(false);
            })
        }
    };
});

app.config(['$httpProvider', function ($httpProvider) {
    $httpProvider.interceptors.push('httpInterceptor');
}]);
app.config(function ($routeProvider) {
    $routeProvider
        .when("/login", {
            templateUrl: 'templates/login.ng',
            controller: 'loginCtrl',
            // css: 'templates/login.css'
        })
        .when("/home", {
            templateUrl: 'templates/home.ng',
            // css: 'templates/home.css',
            controller: 'homeCtrl'
        })
        .when("/event", {
            templateUrl: 'templates/event.ng',
            controller: 'eventCtrl'
        })
        .when("/checkin/:eventId", {
            templateUrl: 'templates/checkin.ng',
            controller: 'checkinCtrl'
        })
        .when("/advanced", {
            templateUrl: 'templates/advanced.ng',
            // css: 'templates/advanced.css',
            controller: 'advancedCtrl'
        })
        .when("/events", {
            templateUrl: 'templates/events.ng',
            controller: 'eventsCtrl'
        })
        .when("/register", {
            templateUrl: 'templates/register.ng',
            controller: 'regCtrl'
        })
        .otherwise({
            templateUrl: 'templates/index.ng',
            controller: 'indexCtrl'
        });
});

app.directive('autofocus', ['$timeout', function($timeout) {
    return {
        restrict: 'A',
        link : function($scope, $element) {
            $timeout(function() {
                $element[0].focus();
            });
        }
    }
}]);

app.controller("navbarCtrl", function ($rootScope, $scope, $http, session, $location) {
    $scope.$watch(
        function() {return $rootScope.isLoggedIn; },
        function (newVal, oldVal) {
            if (newVal != oldVal){
                $scope.username = session.get('username');
            }
        }
    );
    $scope.logIO = function () {
        if ($scope.isLoggedIn){
            session.clear();
            $rootScope.isLoggedIn = false;
            $location.url('/home');
        }else {
            $location.url('/login');
        }
    };

    let list = function () {
        let url = '';
        switch ('/' + $location.url().split('/')[1]) {
            // case '/home':
            //     url = '/login';
            //     break;
            case '/event':
                url = '/home';
                break;
            case '/checkin':
                url = '/event';
                break;
            case '/advanced':
                url = '/home';
                break;
            case '/events':
                url = '/home';
                break;
            case '/register':
                url = '/home';
                break;
        }
        return url;
    };
    $scope.isBackNeed = function () {
        return list() != '';
    };
    $scope.goBack = function () {
        /*window.history.back();*/
        let url = list();
        if (url != '') {
            $location.url(url);
        }
    };
});
app.controller('indexCtrl', function () {
    window.location.href = "#/login";
});
app.controller('loginCtrl', function ($scope, $http, session, $rootScope) {
    $scope.isLoggingIn = false;
    $scope.login = function () {
        $scope.isLoggingIn = true;
        $http.post(domain + "api/auth", {username: $scope.username, password: calcMD5($scope.password)})
            .then(function (result) {
                    session.set("token", result.data.token);
                    session.set("username", $scope.username);
                    $rootScope.isLoggedIn = true;
                    window.location.href = "#/home";
                },
                function (failResult) {
                    $scope.password = "";
                    $scope.isLoggingIn = false;
                    alert("Sign In Failed:" + JSON.stringify(failResult.data));
                });
    }
});
app.controller('homeCtrl', function ($scope, $rootScope) {
    $scope.goAdvanced = function(){
        if ($rootScope.isLoggedIn){
            window.location.href = "#/advanced";
        }
    }
});
app.controller('eventCtrl', function ($scope, $http, syncManager) {
    $scope.selected = undefined;
    $scope.events = [];

    let updateEvents = function () {
        syncManager.downloadEvents(false, function (ret1) {
            $scope.events = ret1;
        });
    };
    updateEvents();

    $scope.selectItem = function (item) {
        $scope.selected = item;
    };
    $scope.isActive = function (item) {
        return $scope.selected == item;
    };
    $scope.continueEvent = function () {
        if ($scope.selected < 0) {
            alert("Please select a event!");
        } else {
            console.log($scope.selected.eventId);
            window.location.href = "#/checkin/" + $scope.selected.eventId;
        }
    };
    $scope.activeFilter = function (event) {
        return event.eventStatus != 2;
    };
});
app.controller('checkinCtrl', function ($scope, $routeParams, session, syncManager) {
    $scope.students = [];
    let eventId = $routeParams.eventId;
    db.all("SELECT * FROM `StudentInfo`", function (err, rows) {
        rows.forEach(function (row) {
            $scope.students.push({
                id: row.id,
                firstName: row.firstName,
                lastName: row.lastName,
                inTime: '',
                outTime: '',
                rfid: row.rfid,
                dorm: row.dorm
            });
        });
        syncManager.downloadEventStudents(false, eventId, function (ret) {
            if (ret != null) {
                for (let i = 0; i < ret.length; i++) {
                    for (let k = 0; k < $scope.students.length; k++) {
                        if ($scope.students[k].id === ret[i].studentId) {
                            $scope.students[k].inTime = ret[i].checkinTime;
                            $scope.students[k].outTime = ret[i].checkoutTime == null ? '' : ret[i].checkoutTime;
                            console.log("id:" + $scope.students[k].id + " in:" + $scope.students[k].inTime + " out:" + $scope.students[k].outTime);
                            break;
                        }
                    }
                }
            }
        });
    });
    $scope.q = '';
    $scope.pic = placeHolderPic;
    $scope.fn = 'First Name';
    $scope.ln = 'Last Name';
    $scope.registerRFID = undefined;
    $scope.networkInProgress = false;
    $scope.searchFilter = function (student) {
        if ($scope.q == '') {
            return student.inTime != '' && student.outTime == '' && student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        } else {
            return student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        }
    };
    $scope.isCheckedIn = function (student) {
        return (student.inTime != '' && student.outTime == '')
    };
    $scope.getCheckinLen = function () {
        let n = 0;
        $scope.students.forEach(function (student) {
            if (student.inTime != '' && student.outTime == '') n++;
        });
        return n;
    };

    $scope.checkinStudent = function (stu) {
        $scope.networkInProgress = true;
        if($scope.registerRFID)
            registerStudent(stu, $scope.registerRFID);
        if (!stu.inTime){
            let stuTmp = angular.copy(stu);
            stuTmp.inTime = new Date().getTime().toString();
            doUploadAdd(stuTmp, 0);
        }else {
            showStudent(stu,false);
        }
    };
    let doUploadAdd = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadAddStudent([s], eventId, function (ret) {
                if (!ret) {
                    console.warn("upload add failed @ attempt" + cnt);
                    doUploadAdd(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].inTime = s.inTime;
                            $scope.networkInProgress = false;
                            $('input[name=qInput]').val('');
                            showStudent(s,true);
                            console.log(s.firstName + " added @ " + s.inTime);
                            break;
                        }
                    }
                }
            });
        }else{
            alert("upload add "+s.lastName+" "+s.firstName+" failed! Student is not checked in!");
        }
    };

    let dispTimeout = undefined;
    let showStudent = function (student, changed) {
        if (dispTimeout !== undefined)
            clearTimeout(dispTimeout);
        $scope.pic = photoPath + '/' + student.id + '.jpg';
        $scope.fn = student.firstName;
        $scope.ln = student.lastName;
        if (!changed)
        $scope.$apply();
        dispTimeout = setTimeout(function () {
            console.log('its high noon');
            $scope.pic = placeHolderPic;
            $scope.fn = 'First Name';
            $scope.ln = 'Last Name';
            $scope.$apply();
        },5000);
    };

    $scope.deleteStudent = function (stu) {
        // if (confirm('Do you really want to remove this student?')) {
        $scope.networkInProgress = true;
        doUploadRm(stu, 0);
        // }
    };
    let doUploadRm = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadRemoveStudent([s], eventId, function (ret) {
                if (!ret){
                    console.warn("upload remove failed @ attempt" + cnt);
                    doUploadRm(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].inTime = '';
                            $scope.networkInProgress = false;
                            console.log($scope.students[i].firstName + " removed");
                            $('input[name=qInput]').val('');
                            showStudent($scope.students[i],true);
                            break;
                        }
                    }
                }
            });
        }else {
            alert("upload remove "+s.lastName+" "+s.firstName+" failed!");
        }
    };

    let registerStudent = function (stu, rfid) {
        let stuTmp = stu;
        stuTmp.rfid = rfid;
        doUploadReg(stuTmp, 0);
    };
    let doUploadReg = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadRegister(s.id, s.rfid, function (ret) {
                if (!ret){
                    console.warn("upload remove failed @ attempt" + cnt);
                    doUploadReg(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].rfid = s.rfid;
                            break;
                        }
                    }
                    $scope.registerRFID = undefined;
                }
            });
        }else {
            alert("upload register "+s.lastName+" "+s.firstName+" failed!");
        }
    };

    $scope.$on('card-attach', function(event, rfid) {
        db.get('SELECT * FROM `StudentInfo` WHERE `rfid` = ? COLLATE NOCASE', [rfid.toUpperCase()], function (err, row) {
            if (err == undefined) {
                if (row === undefined){
                    console.log('card DNE in DB');
                    $scope.registerRFID = rfid.toUpperCase();
                    $scope.$apply();
                }else {
                    $scope.students.forEach(function (stu) {
                            if (row.id == stu.id){
                                $scope.checkinStudent(stu);
                            }
                        }
                    );
                }
            }else {
                console.warn('failed query from DB :'+err);
            }
        });
    })

});
app.controller('advancedCtrl', function ($scope, syncManager) {
    $scope.downloadStudentInfo = function () {
        $scope.downloadStudentInfoInProgress = true;
        syncManager.downloadStudentInfo(function (ret) {
            $scope.downloadStudentInfoInProgress = false;
        });
    };
    $scope.downloadEvents = function () {
        $scope.downloadEventsInProgress = true;
        syncManager.downloadEvents(false, function (ret) {
            $scope.downloadEventsInProgress = false;
        });
    };
    $scope.downloadPics = function () {
        $scope.value = 0;
        $scope.downloadPicsInProgress = true;
        syncManager.downloadPics(function (cur, max) {
            if (max != null){$scope.maxv = max}
            if (cur) ++$scope.value;
            if ($scope.value >= $scope.maxv){
                $scope.downloadPicsInProgress = false;
            }
        })
    };
    $scope.removePics = function () {
        fs.removeSync(photoPath);
    };
    $scope.value = 0;
    $scope.maxv = 100;
    $scope.downloadStudentInfoInProgress = false;
    $scope.downloadEventsInProgress = false;
    $scope.downloadPicsInProgress = false;
});
app.controller('eventsCtrl', function ($scope, $http, syncManager) {
    $scope.selected = undefined;
    $scope.events = [];
    $scope.eventName = '';

    let updateEvents = function () {
        syncManager.downloadEvents(false, function (ret1) {
            // syncManager.readUncompletedEvents(function (ret2) {
            //     $scope.events = ret2;
            //     $scope.$apply();
            // });
            $scope.events = ret1;
        });
    };
    // $http.get(domain + "api/event/list").then(function (successReturn) {
    //     $scope.events = successReturn.data.events;
    // });
    updateEvents();

    $scope.selectItem = function (item) {
        $scope.selected = item;
    };
    $scope.isActive = function (item) {
        return $scope.selected == item;
    };
    $scope.activeFilter = function (event) {
        return event.eventStatus != 2;
    };
    $scope.addEvent = function () {
        let n = $scope.eventName;
        syncManager.uploadAddEvent(n, function (ret) {
            if (ret !== null) {
                updateEvents();
            }
        });
    };
    $scope.completeEvent = function () {
        if (confirm('Do you really want to complete this event?')){
            syncManager.uploadCompleteEvent(false, $scope.selected.eventId, function (ret) {
                // syncManager.readUncompletedEvents(function (ret2) {
                //     $scope.events = ret2;
                //     $scope.$apply();
                // });
                if (ret){
                    updateEvents();
                }
            });
        }
    }

});
app.controller('regCtrl', function ($scope, syncManager) {
    $scope.students = [];
    $scope.q = '';
    $scope.pic = placeHolderPic;
    $scope.fn = 'First Name';
    $scope.ln = 'Last Name';
    $scope.regRfid = undefined;
    $scope.selectedStudent = undefined;
    db.all("SELECT * FROM `StudentInfo`", function (err, rows) {
        rows.forEach(function (row) {
            $scope.students.push({
                id: row.id,
                firstName: row.firstName,
                lastName: row.lastName,
                inTime: '',
                outTime: '',
                rfid: row.rfid,
                dorm: row.dorm
            });
        });
    });
    $scope.searchFilter = function (student) {
        return student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase()
            || student.id.toString().substring(0, $scope.q.length) === $scope.q;
    };

    $scope.$on('card-attach', function(event, rfid){
        if ($scope.regRfid === undefined){
            $scope.regRfid = rfid;
            $scope.$apply();
            $('input[name=qInput]').focus();
        }
    });
    $scope.selectItem = function(item){
        $scope.selectedStudent = item;
    };
    $scope.isActive = function (item) {
        return $scope.selectedStudent == item;
    };
    $scope.registerStudent = function(){
        doReg($scope.selectedStudent, $scope.regRfid, 0);
    };

    let dispTimeout = undefined;
    let showStudent = function (student, changed) {
        if (dispTimeout !== undefined)
            clearTimeout(dispTimeout);
        $scope.pic = photoPath + '/' + student.id + '.jpg';
        $scope.fn = student.firstName;
        $scope.ln = student.lastName;
        if (!changed)
            $scope.$apply();
        dispTimeout = setTimeout(function () {
            console.log('its high noon');
            $scope.pic = placeHolderPic;
            $scope.fn = 'First Name';
            $scope.ln = 'Last Name';
            $scope.$apply();
        },5000);
    };

    let doReg = function(s, rfid, cnt){
        if (cnt < 3){
            syncManager.uploadRegister(s.id, rfid,function (ret) {
                if (!ret){
                    doReg(s, rfid, cnt+1);
                }else {
                    for (let i = 0; i < $scope.students.length; i++){
                        if (s.id == $scope.students[i].id){
                            $scope.students[i].rfid = rfid;
                            db.run("UPDATE `StudentInfo` SET `rfid` = ? WHERE `id` = ?", [rfid, s.id],function (err) {
                                if (err) console.error(err);
                                $scope.regRfid = undefined;
                                $scope.selectedStudent = undefined;
                                $('input[name=qInput]').val('');
                                showStudent(s,false);
                            });
                            break;
                        }
                    }
                }
            });
        }else {
            alert("upload register "+s.lastName+" "+s.firstName+" failed!");
        }
    };

});