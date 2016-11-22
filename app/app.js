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
            " nickName  TEXT                            ," +
            " rfid      TEXT                            ," +
            " dorm      TEXT                           );" +
            "CREATE TABLE if not exists StudentCheck     " +
            "(id     TEXT                    NOT NULL," +
            " eventId   TEXT                    NOT NULL," +
            " inTime    TEXT                            ," +
            " outTime   TEXT                            ," +
            " PRIMARY KEY (id, eventId)             );" +
            "CREATE TABLE if not exists StudentReg       " +
            "(id     TEXT PRIMARY KEY UNIQUE NOT NULL," +
            " rfid      TEXT                           );" +
            "CREATE TABLE if not exists Events           " +
            "(eventId   TEXT PRIMARY KEY UNIQUE NOT NULL," +
            " eventName TEXT                            ," +
            " eventTime TEXT                            ," +
            " token     TEXT                            ," +
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

/**
 * standardize nulls
 * @param s if input is null, undefined, 'null'(of any cases)
 * @returns {string} return '' else s
 */
let standardize = function (s) {
    return !s || s.toUpperCase() == 'NULL' ? '' : s;
};

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

app.run(function ($rootScope) {
    let registerDevices = function (event) {
        currentDevices = event.devices;
        currentDevices.forEach(function (device) {
            device.on('card-inserted', event => {
                let card = event.card;
                console.log(`Card '${card.getAtr()}' inserted into '${card.device}'`);
                $rootScope.$broadcast('card-attach', card.getAtr());
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
                    db.run("DELETE FROM `StudentInfo`");
                    let stmt = db.prepare("INSERT OR REPLACE INTO `StudentInfo` ('id','firstName','lastName','nickName','rfid','dorm') VALUES (?,?,?,?,?,?)");
                    for (let i = 0; i < result.data.students.length; i++) {
                        let student = result.data.students[i];
                        stmt.run([student.studentId, student.firstName, student.lastName, student.nickName, student.rfid, student.dorm]);
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
         * @param callback return events while succeed, return null if failed
         */
        downloadEvents: function (callback) {
            $http.get(domain + 'api/event/list').then(function (result) {
                callback(result.data.events);
            }, function (error) {
                alert("Download Events Error!");
                callback(null);
            });
        },
        /**
         * Download event detail (students)
         * @param eventId Event ID
         * @param callback return students while succeed, return null if failed
         */
        downloadEventStudents: function (eventId, callback) {
            $http.get(domain + 'api/event/' + eventId + '/detail').then(function (result) {
                callback(result.data.students);
            }, function (error) {
                alert("Download Student @ " + eventId + " Error!");
                callback(null);
            });
        },
        downloadPics: function (callback) {
            console.log(photoPath);
            fs.ensureDirSync(photoPath);
            db.each("SELECT * FROM `StudentInfo`", [], function (err, row) {
                    $http.get(domain + 'api/student/' + row.id + '/image', {responseType: 'arraybuffer'}).then(function (result) {
                        let f = fs.createWriteStream(photoPath + '/' + row.id + '.jpg');
                        f.write(Buffer.from(result.data), function (err, written, string) {
                            if (err) console.warn(err.code);
                            // else console.log('write file succeed @' + row.id);
                            f.close();
                        });
                        callback(true, null);
                    }, function (error) {
                        console.warn('http error occur @' + row.id + ' :' + error);
                        callback(true, null);
                    });
                },
                function (err, rowN) {
                    callback(false, rowN);
                });
        },

        /**
         * Upload add students to server
         * @param students Array of students, need at least id, inTime, outTime
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
                callback(suc.data);
            }, function (err) {
                callback(null);
            });
        },
        uploadCompleteEvent: function (eventId, callback) {
            $http.post(domain + 'api/event/' + eventId + '/complete', {}).then(function (suc) {
                // if (local) {
                //     db.run("UPDATE `Events` SET `status` = ? WHERE `eventId` = ?", [2, eventId], function (err) {
                //         if (err) {
                //             console.warn('uploadCompleteEvent DB error:' + err);
                //         }
                //     });
                // }
                callback(true);
            }, function (err) {
                callback(false);
            });
        },
        /**
         * update student rfid
         * @param id student id
         * @param rfid new rfid
         * @param callback true if 200, else false
         */
        uploadRegister: function (id, rfid, callback) {
            $http.post(domain + 'api/student/' + id + '/update', {rfid: rfid}).then(function (suc) {
                db.run('UPDATE `StudentInfo` SET `rfid` = ? WHERE id = ?', [rfid, id], function (err) {
                    if (err) {
                        console.warn('uploadRegister DB error:' + err);
                    }
                    callback(true);
                });
            }, function (err) {
                callback(false);
            })
        },
        uploadCheckoutEvent: function (eventId, callback) {
            $http.post(domain + 'api/event/' + eventId + '/checkout', {}).then(
                function (suc) {
                    callback(suc.data);
                },
                function (err) {
                    callback(null);
                }
            );
        },
        uploadGiveBackEvent: function (event, callback) {
            $http.post(domain + 'api/event/' + event.eventId + '/return', {authKey: event.token}).then(
                function (suc) {
                    callback(true);
                },
                function (err) {
                    callback(false);
                }
            );
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

app.directive('autofocus', ['$timeout', function ($timeout) {
    return {
        restrict: 'A',
        link: function ($scope, $element) {
            $timeout(function () {
                $element[0].focus();
            });
        }
    }
}]);

app.controller("navbarCtrl", function ($rootScope, $scope, $http, session, $location) {
    $scope.$watch(
        function () {
            return $rootScope.isLoggedIn;
        },
        function (newVal, oldVal) {
            if (newVal != oldVal) {
                $scope.username = session.get('username');
            }
        }
    );
    $scope.logIO = function () {
        if ($scope.isLoggedIn) {
            session.clear();
            $rootScope.isLoggedIn = false;
            $location.url('/home');
        } else {
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
                if ($rootScope.isLoggedIn)
                    url = '/event';
                else url = '/home';
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
    $scope.goCheckin = function () {
        if ($rootScope.isLoggedIn) {
            window.location.href = "#/event";
        } else {
            db.get("SELECT * FROM `EVENTS`", [], function (err, row) {
                if (!row) {
                    alert("Please log in and go to Events menu to check out an event!");
                } else {
                    window.location.href = "#/checkin/" + row.eventId;
                }
            });
        }
    };
    $scope.goEvents = function () {
        if ($rootScope.isLoggedIn) {
            window.location.href = "#/events";
        }
    };
    $scope.goReg = function () {
        if ($rootScope.isLoggedIn) {
            window.location.href = "#/register";
        }
    };
    $scope.goAdvanced = function () {
        if ($rootScope.isLoggedIn) {
            window.location.href = "#/advanced";
        }
    }
});
app.controller('eventCtrl', function ($scope, $http, syncManager) {
    $scope.selected = undefined;
    $scope.events = [];

    let updateEvents = function () {
        syncManager.downloadEvents(function (ret1) {
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
app.controller('checkinCtrl', function ($scope, $routeParams, session, syncManager, $rootScope) {
    $scope.students = [];
    let eventId = $routeParams.eventId;
    db.all("SELECT * FROM `StudentInfo`", function (err, rows) {
        rows.forEach(function (row) {
            $scope.students.push({
                id: row.id,
                firstName: row.firstName,
                lastName: row.lastName,
                nickName: row.nickName,
                inTime: '',
                outTime: '',
                rfid: row.rfid,
                dorm: row.dorm
            });
        });
        if ($rootScope.isLoggedIn) {
            syncManager.downloadEventStudents(eventId, function (ret) {
                if (ret != null) {
                    for (let i = 0; i < ret.length; i++) {
                        for (let k = 0; k < $scope.students.length; k++) {
                            if ($scope.students[k].id === ret[i].studentId) {
                                $scope.students[k].inTime = standardize(ret[i].checkinTime);
                                $scope.students[k].outTime = standardize(ret[i].checkoutTime);
                                console.log("id:" + $scope.students[k].id + " in:" + $scope.students[k].inTime + " out:" + $scope.students[k].outTime);
                                break;
                            }
                        }
                    }
                }
            });
        }
        else {
            db.all("SELECT * FROM `StudentCheck` WHERE `eventId` = ?", [eventId], function (err, rows) {
                for (let i = 0; i < rows.length; i++) {
                    for (let k = 0; k < $scope.students.length; k++) {
                        if ($scope.students[k].id === rows[i].id) {
                            $scope.students[k].inTime = standardize(rows[i].inTime);
                            $scope.students[k].outTime = standardize(rows[i].outTime);
                            console.log("id:" + $scope.students[k].id + " in:" + $scope.students[k].inTime + " out:" + $scope.students[k].outTime);
                            break;
                        }
                    }
                }
                $scope.$apply();
            });
        }

    });
    $scope.q = '';
    $scope.pic = placeHolderPic;
    $scope.fn = 'First Name';
    $scope.ln = 'Last Name';
    $scope.nn = 'Nickname';
    $scope.registerRFID = undefined;
    $scope.networkInProgress = false;
    $scope.searchFilter = function (student) {
        if ($scope.q == '') {
            return student.inTime && !student.outTime && student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        } else {
            return student.lastName.substring(0, $scope.q.length).toLowerCase() === $scope.q.toLowerCase();
        }
    };
    $scope.isCheckedIn = function (student) {
        return (student.inTime && !student.outTime)
    };
    $scope.getCheckinLen = function () {
        let n = 0;
        $scope.students.forEach(function (student) {
            if (student.inTime && !student.outTime) n++;
        });
        return n;
    };

    $scope.checkinStudent = function (stu) {
        $scope.networkInProgress = true;
        if ($scope.registerRFID)
            registerStudent(stu, $scope.registerRFID);
        if (!stu.inTime) {
            if ($rootScope.isLoggedIn) {
                //online
                let stuTmp = angular.copy(stu);
                stuTmp.inTime = new Date().getTime().toString();
                doUploadAdd(stuTmp, 0);
            } else {
                //offline
                let time = new Date().getTime().toString();
                db.run("INSERT OR REPLACE INTO `StudentCheck` ('id','eventId','inTime','outTime') VALUES (?,?,?,?)", [stu.id, eventId, time, stu.outTime], function (err) {
                    if (!err) {
                        stu.inTime = time;
                        $scope.q = '';
                        $scope.networkInProgress = false;
                        showStudent(stu, false);
                    }
                });
            }
        } else {
            showStudent(stu, false);
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
                            $scope.q = '';
                            showStudent(s, true);
                            console.log(s.firstName + " added @ " + s.inTime);
                            break;
                        }
                    }
                }
            });
        } else {
            alert("upload add " + s.lastName + " " + s.firstName + " failed! Student is not checked in!");
        }
    };

    let dispTimeout = undefined;
    let showStudent = function (student, changed) {
        if (dispTimeout !== undefined)
            clearTimeout(dispTimeout);
        $scope.pic = photoPath + '/' + student.id + '.jpg';
        $scope.fn = student.firstName;
        $scope.ln = student.lastName;
        $scope.nn = student.nickName;
        if (!changed)
            $scope.$apply();
        dispTimeout = setTimeout(function () {
            console.log('its high noon');
            $scope.pic = placeHolderPic;
            $scope.fn = 'First Name';
            $scope.ln = 'Last Name';
            $scope.nn = 'Nick Name';
            $scope.$apply();
        }, 5000);
    };

    $scope.deleteStudent = function (stu) {
        // if (confirm('Do you really want to remove this student?')) {
        $scope.networkInProgress = true;
        if ($rootScope.isLoggedIn) {
            doUploadRm(stu, 0);
        } else {
            db.run("DELETE FROM `StudentCheck` WHERE `id` = ? AND `eventId` = ?", [stu.id, eventId], function (err) {
                if (!err) {
                    stu.inTime = '';
                    console.log(stu + " removed");
                    $scope.q = '';
                    $scope.networkInProgress = false;
                    showStudent(stu, false);
                }
            });
        }
        // }
    };
    let doUploadRm = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadRemoveStudent([s], eventId, function (ret) {
                if (!ret) {
                    console.warn("upload remove failed @ attempt" + cnt);
                    doUploadRm(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].inTime = '';
                            $scope.networkInProgress = false;
                            console.log($scope.students[i].firstName + " removed");
                            $scope.q = '';
                            showStudent($scope.students[i], true);
                            break;
                        }
                    }
                }
            });
        } else {
            alert("upload remove " + s.lastName + " " + s.firstName + " failed!");
        }
    };

    let registerStudent = function (stu, rfid) {
        if ($rootScope.isLoggedIn) {
            let stuTmp = stu;
            stuTmp.rfid = rfid;
            doUploadReg(stuTmp, 0);
        } else {
            db.serialize(function () {
                db.run("INSERT OR REPLACE INTO `StudentReg` ('id','rfid') VALUES (?,?)", [stu.id, rfid.toUpperCase()]);
                db.run("UPDATE `StudentInfo` SET `rfid` = ? WHERE `id` = ?", [rfid.toUpperCase(), stu.id]);
                $scope.registerRFID = undefined;
                stu.rfid = rfid;
            });
        }

    };
    let doUploadReg = function (s, cnt) {
        if (cnt < 3) {
            syncManager.uploadRegister(s.id, s.rfid, function (ret) {
                if (!ret) {
                    console.warn("upload remove failed @ attempt" + cnt);
                    doUploadReg(s, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.registerRFID = undefined;
                            $scope.students[i].rfid = s.rfid;
                            break;
                        }
                    }

                }
            });
        } else {
            alert("upload register " + s.lastName + " " + s.firstName + " failed!");
        }
    };

    $scope.$on('card-attach', function (event, rfid) {
        db.get('SELECT * FROM `StudentInfo` WHERE `rfid` = ? COLLATE NOCASE', [rfid.toUpperCase()], function (err, row) {
            if (err == undefined) {
                if (row === undefined) {
                    console.log('card DNE in DB');
                    $scope.registerRFID = rfid.toUpperCase();
                    $scope.$apply();
                } else {
                    $scope.students.forEach(function (stu) {
                            if (row.id == stu.id) {
                                $scope.checkinStudent(stu);
                            }
                        }
                    );
                }
            } else {
                console.warn('failed query from DB :' + err);
            }
        });
    })

});
app.controller('advancedCtrl', function ($scope, syncManager) {
    $scope.downloadStudentInfo = function () {
        if (!$scope.downloadStudentInfoInProgress) {
            $scope.downloadStudentInfoInProgress = true;
            syncManager.downloadStudentInfo(function (ret) {
                $scope.downloadStudentInfoInProgress = false;
            });
        }
    };
    $scope.downloadEvents = function () {
        if (!$scope.downloadEventsInProgress) {
            $scope.downloadEventsInProgress = true;
            syncManager.downloadEvents(function (ret) {
                $scope.downloadEventsInProgress = false;
            });
        }
    };
    $scope.downloadPics = function () {
        if (!$scope.downloadPicsInProgress) {
            $scope.value = 0;
            $scope.downloadPicsInProgress = true;
            syncManager.downloadPics(function (cur, max) {
                if (max != null) {
                    $scope.maxv = max
                }
                if (cur) ++$scope.value;
                if ($scope.value >= $scope.maxv) {
                    $scope.downloadPicsInProgress = false;
                }
            });
        }
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
    $scope.localEvent = undefined;
    $scope.networkInProgress = true;

    let updateEvents = function () {
        db.get("SELECT * FROM `Events`", [], function (err, row) {
            if (row) {
                $scope.localEvent = {
                    eventId: row.eventId,
                    eventName: row.eventName,
                    eventTime: row.eventTime,
                    eventStatus: row.status,
                    token: row.token
                };
            } else {
                $scope.localEvent = undefined;
            }
            syncManager.downloadEvents(function (ret1) {
                $scope.events = ret1;
                $scope.networkInProgress = false;
            });
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
        $scope.networkInProgress = true;
        let n = $scope.eventName;
        syncManager.uploadAddEvent(n, function (ret) {
            if (ret !== null) {
                updateEvents();
                $scope.networkInProgress = false;
            }
        });
    };
    $scope.completeEvent = function () {
        if (confirm('Do you really want to complete this event?')) {
            $scope.networkInProgress = true;
            syncManager.uploadCompleteEvent(false, $scope.selected.eventId, function (ret) {
                if (ret) {
                    updateEvents();
                    $scope.networkInProgress = false;
                }
            });
        }
    };
    $scope.checkOutEvent = function () {
        $scope.networkInProgress = true;
        let evt = angular.copy($scope.selected);
        syncManager.uploadCheckoutEvent(evt.eventId, function (ret) {
            if (ret) {
                db.run("INSERT OR REPLACE INTO `Events` ('eventId','eventName','eventTime','token','status') VALUES (?,?,?,?,?)", [evt.eventId, evt.eventName, evt.eventTime, ret.returnKey, evt.eventStatus], function (err) {
                    if (!err) {
                        db.serialize(function () {
                            db.run("BEGIN TRANSACTION");
                            let stmt = db.prepare("INSERT OR REPLACE INTO `StudentCheck` ('id','eventId','inTime','outTime') VALUES (?,?,?,?)");
                            ret.students.forEach(function (stu) {
                                stmt.run([stu.studentId, evt.eventId, standardize(stu.checkinTime), standardize(stu.checkoutTime)]);
                            });
                            stmt.finalize();
                            db.run("COMMIT");
                            updateEvents();
                            $scope.networkInProgress = false;
                        });
                    }
                });
            } else {
                alert("Check out failed!");
            }
        });
    };
    $scope.uploadEvent = function () {
        $scope.networkInProgress = true;
        let evt = $scope.localEvent;
        let add = [];
        let reg = [];
        db.all("SELECT * FROM `StudentCheck` WHERE `eventId` = ?", [evt.id], function (err, rows) {
            rows.forEach(function (row) {
                add.push({
                    id: row.id,
                    inTime: row.inTime,
                    outTime: row.outTime
                });
            });
            console.log("add array created");
            db.all("SELECT * FROM `StudentReg`", [], function (err, rows) {
                rows.forEach(function (row) {
                    reg.push({
                        id: row.id,
                        rfid: row.rfid
                    });
                });
                console.log("reg array created");
                uploadEvents(evt, add, reg);
            });
        });
    };

    let uploadEvents = function (evt, add, reg) {
        syncManager.uploadGiveBackEvent(evt, function (ret) {
            console.log("uploadGiveBackEvent");
            if (ret) {
                db.run("DELETE FROM `Events` WHERE `eventId` = ?", [evt.eventId], function (err) {
                    if (!err) {
                        syncManager.uploadAddStudent(add, evt.eventId, function (ret) {
                            console.log("uploadAddStudent");
                            if (ret) {
                                db.run("DELETE FROM `StudentCheck`", [], function (err) {
                                    console.log("DELETE FROM `StudentCheck`");
                                    if (!err) {
                                        if (reg.length == 0) {
                                            updateEvents();
                                            $scope.networkInProgress = false;
                                        } else {
                                            let cnt = 0;
                                            reg.forEach(function (stu) {
                                                syncManager.uploadRegister(stu.id, stu.rfid, function (ret) {
                                                    cnt += 1;
                                                    console.log("uploadRegister");
                                                    if (ret) {
                                                        db.run("DELETE FROM `StudentReg` WHERE `id` = ?", [stu.id], function (err) {
                                                            if (cnt >= reg.length) {
                                                                updateEvents();
                                                                $scope.networkInProgress = false;
                                                            }
                                                        });
                                                    } else {
                                                        console.warn("update " + stu.id + " failed!");
                                                        if (cnt >= reg.length) {
                                                            updateEvents();
                                                            $scope.networkInProgress = false;
                                                        }
                                                    }
                                                });
                                            });
                                        }
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });

    }
});
app.controller('regCtrl', function ($scope, syncManager, $rootScope) {
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

    $scope.$on('card-attach', function (event, rfid) {
        if ($scope.regRfid === undefined) {
            $scope.regRfid = rfid;
            $scope.$apply();
            $('input[name=qInput]').focus();
        }
    });
    $scope.selectItem = function (item) {
        $scope.selectedStudent = item;
    };
    $scope.isActive = function (item) {
        return $scope.selectedStudent == item;
    };
    $scope.registerStudent = function () {
        if ($rootScope.isLoggedIn)
            doReg($scope.selectedStudent, $scope.regRfid, 0);
        else {
            db.run("INSERT OR REPLACE INTO `StudentReg` ('id','rfid') VALUES (?,?)", [$scope.selectedStudent.id, $scope.regRfid.toUpperCase()], function (err) {
                if (!err) {
                    db.run("UPDATE `StudentInfo` SET `rfid` = ? WHERE `id` = ?", [$scope.regRfid.toUpperCase(), $scope.selectedStudent.id], function (err) {
                        if (!err) {
                            $scope.regRfid = undefined;
                            $scope.q = '';
                            showStudent($scope.selectedStudent, false);
                            $scope.selectedStudent = undefined;
                        }
                    });
                }
            });
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
        }, 5000);
    };

    let doReg = function (s, rfid, cnt) {
        if (cnt < 3) {
            syncManager.uploadRegister(s.id, rfid, function (ret) {
                if (!ret) {
                    doReg(s, rfid, cnt + 1);
                } else {
                    for (let i = 0; i < $scope.students.length; i++) {
                        if (s.id == $scope.students[i].id) {
                            $scope.students[i].rfid = rfid;
                            db.run("UPDATE `StudentInfo` SET `rfid` = ? WHERE `id` = ?", [rfid, s.id], function (err) {
                                if (err) console.error(err);
                                $scope.regRfid = undefined;
                                $scope.selectedStudent = undefined;
                                $scope.q = '';
                                showStudent(s, false);
                            });
                            break;
                        }
                    }
                }
            });
        } else {
            alert("upload register " + s.lastName + " " + s.firstName + " failed!");
        }
    };

});