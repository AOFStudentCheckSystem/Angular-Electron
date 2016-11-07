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
        get: function () {
            return window.sessionStorage.getItem("token");
        },
        set: function (jwt) {
            window.sessionStorage.setItem("token",jwt);
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
            if(session.get() !== undefined && session.get() != ""){
                config.headers['Authorization'] = session.get();
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
        .otherwise({
            templateUrl: 'templates/index.ng',
            controller: 'indexCtrl'
        });

});
app.controller("navbarCtrl",function ($scope, $http) {

});
app.controller('indexCtrl',function ($scope, $http, session) {
    window.location.href="#/login";
});
app.controller('loginCtrl',function ($scope, $http, session) {
    $scope.login = function(){
        $http.post(domain+"api/auth",{username:$scope.username, password:calcMD5($scope.password)})
            .then(function (result) {
                session.set(result.data.token);
            },
            function (failResult) {
                $scope.password = "";
                alert("Sign In Failed");
            });
    }

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