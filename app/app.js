const smartcard = require('smartcard');
const electron = require('electron');
const eapp = electron.remote.app;
const Devices = smartcard.Devices;
const devices = new Devices();
let currentDevices = [];

const domain = "http://hn2.guardiantech.com.cn:57463/";

var app = angular.module("studentCheck",['ngRoute','routeStyles'], function ($httpProvider) {
    $httpProvider.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded;charset=utf-8';
    var param = function (obj) {
        var query = '', name, value, fullSubName, subName, subValue, innerObj, i;

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
app.factory("session", function () {
    return {
        get: function (key) {
            return window.sessionStorage.getItem(key);
        },
        set: function (key,value) {
            window.sessionStorage.setItem(key,value);
        }
    };
});
app.factory('httpInterceptor', ['$q', '$injector','session', function ($q, $injector ,session) {
    var httpInterceptor = {
        'responseError': function (response) {
            return $q.reject(response);
        },
        'response': function (response) {
            return response;
        },
        'request': function (config) {
            if(session.get("token") !== undefined && session.get("token") != ""){
                config.headers['Authorization'] = session.get("token");
            }
            return config;
        },
        'requestError': function (config) {
            return $q.reject(config);
        }
    };
    return httpInterceptor;
}]);
app.config(['$httpProvider', function ($httpProvider) {
    $httpProvider.interceptors.push('httpInterceptor');
}]);
app.config(function ($routeProvider) {
    $routeProvider
        .when("/login",{
            templateUrl: 'templates/login.ng',
            controller: 'loginCtrl',
            css: 'templates/login.css'
        })
        .when("/home",{
            templateUrl: 'templates/home.ng',
            css: 'templates/home.css'
        })
        .otherwise({
            templateUrl: 'templates/index.ng',
            controller: 'indexCtrl'
        });

});
app.controller("navbarCtrl",function ($scope, $http, session) {
    $scope.$watchCollection(
        function () {
            return [session.get("token")!=null, session.get("username")];
        },
        function (newVal, oldVal) {
            $scope.isLoggedIn = newVal[0];
            $scope.username = newVal[1];
        }
    );
});
app.controller('indexCtrl',function ($scope, $http, session) {
    window.location.href="#/login";
});
app.controller('loginCtrl',function ($scope, $http, session) {
    $scope.isLoggingIn = false;
    $scope.login = function(){
        $scope.isLoggingIn = true;
        $http.post(domain+"api/auth",{username:$scope.username, password:calcMD5($scope.password)})
            .then(function (result) {
                session.set("token",result.data.token);
                session.set("username",$scope.username);
                window.location.href="#/home";
            },
            function (failResult) {
                $scope.password = "";
                $scope.isLoggingIn = false;
                alert("Sign In Failed");
            });
    }

});

app.controller('homeCtrl',function ($scope, session) {

});
// app.controller("cardDisplayCtrl",function ($scope) {
//     $scope.card = "No Reader";
//     $scope.card1 = "NN";
//     $scope.onRegister = function () {
//         alert('a');
//         console.log(currentDevices);
//         if (currentDevices.length > 0){
//             currentDevices.forEach(function (elem) {
//                 elem.on('card-inserted', function (event) {
//                     let card = event.card;
//                     $scope.card1 = card.getAtr();
//                     $scope.$apply();
//                 });
//             })
//         }
//         devices.on('device-activated', function (event) {
//             $scope.card1="No Card";
//             $scope.$apply();
//             currentDevices = event.devices;
//             let device = event.device;
//             device.on('card-inserted', function (event) {
//                 let card = event.card;
//                 $scope.card = card.getAtr();
//                 $scope.$apply();
//
//             });
//             device.on('card-removed', function (event) {
//                 $scope.card = "No Card";
//                 $scope.$apply();
//
//             });
//         });
//     };
//
//
//     // window.localStorage.setItem("hello","test");
//     devices.on('device-activated', function (event) {
//         $scope.card="No Card";
//         $scope.$apply();
//         currentDevices = event.devices;
//         let device = event.device;
//         device.on('card-inserted', function (event) {
//             let card = event.card;
//             $scope.card = card.getAtr();
//             $scope.$apply();
//
//         });
//         device.on('card-removed', function (event) {
//             $scope.card = "No Card";
//             $scope.$apply();
//
//         });
//     });
//     devices.on('device-deactivated', function (event) {
//         $scope.card="No Reader";
//         $scope.$apply();
//     });
//
//
// });