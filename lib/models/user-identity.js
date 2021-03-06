/**
 * Tracks third-party logins and profiles.
 *
 * @param {String} provider   Auth provider name, such as facebook, google, twitter, linkedin.
 * @param {String} authScheme Auth scheme, such as oAuth, oAuth 2.0, OpenID, OpenID Connect.
 * @param {String} externalId Provider specific user ID.
 * @param {Object} profile User profile, see http://passportjs.org/guide/profile.
 * @param {Object} credentials Credentials.  Actual properties depend on the auth scheme being used:
 *
 * - oAuth: token, tokenSecret
 * - oAuth 2.0: accessToken, refreshToken
 * - OpenID: openId
 * - OpenID: Connect: accessToken, refreshToken, profile
 * @param {*} userId The LoopBack user ID.
 * @param {Date} created The created date
 * @param {Date} modified The last modified date
 *
 * @class
 * @inherits {DataModel}
 */
 module.exports = function(UserIdentity) {
  var loopback = require('loopback');
  var utils = require('./utils');

  /*!
   * Create an access token for the given user
   * @param {User} user The user instance
   * @param {Number} [ttl] The ttl in millisenconds
   * @callback {Function} cb The callback function
   * @param {Error|String} err The error object
    * param {AccessToken} The access token
   */
  function createAccessToken(user, ttl, cb) {
    if (arguments.length === 2 && typeof ttl === 'function') {
      cb = ttl;
      ttl = 0;
    }
    user.accessTokens.create({
      created: new Date(),
      ttl: Math.min(ttl || user.constructor.settings.ttl,
        user.constructor.settings.maxTTL)
    }, cb);
  }

  function profileToUser(provider, profile, options) {
    // TODO: what if email doesn't exist?
    var email = profile.emails && profile.emails[0] && profile.emails[0].value;
    var username = profile.username || profile.id;
    var password = utils.generateKey('password');
    var userObj = {
      username: username,
      password: password,
      status: 'normal_github',
      avatarUrl: JSON.parse(profile._raw).avatar_url
    };
    if (email) {
      userObj.email = email;
    }
    return userObj;
  }

  /**
   * Log in with a third-party provider such as Facebook or Google.
   *
   * @param {String} provider The provider name.
   * @param {String} authScheme The authentication scheme.
   * @param {Object} profile The profile.
   * @param {Object} credentials The credentials.
   * @param {Object} [options] The options.
   * @callback {Function} cb The callback function.
   * @param {Error|String} err The error object or string.
   * @param {Object} user The user object.
   * @param {Object} [info] The auth info object.
   *
   * -  identity: UserIdentity object
   * -  accessToken: AccessToken object
   */
  UserIdentity.login = function (provider, authScheme, profile, credentials,
                                 options, cb) {
    options = options || {};
    if(typeof options === 'function' && cb === undefined) {
      cb = options;
      options = {};
    }
    var autoLogin = options.autoLogin || options.autoLogin === undefined;
    var userIdentityModel = utils.getModel(this, UserIdentity);
    profile.id = profile.id || profile.openid;
    userIdentityModel.findOne({where: {
      provider: provider,
      externalId: profile.id
    }}, function (err, identity) {
      if (err) {
        return cb(err);
      }
      if (identity) {
        identity.credentials = credentials;
        return identity.updateAttributes({profile: profile,
          credentials: credentials, modified: new Date()}, function (err, i) {
          // Find the user for the given identity
          return identity.user(function (err, user) {
            // Create access token if the autoLogin flag is set to true
            if(!err && user && autoLogin) {
              return (options.createAccessToken || createAccessToken)(user, function(err, token) {
                cb(err, user, identity, token);
              });
            }
            cb(err, user, identity);
          });
        });
      }
      // Find the user model
      var userModel = (userIdentityModel.relations.user &&
                       userIdentityModel.relations.user.modelTo) ||
                       loopback.getModelByType(loopback.User);
      var userObj = (options.profileToUser || profileToUser)(provider, profile, options);
      if (!userObj.email && !options.emailOptional) {
        process.nextTick(function() {
          return cb('email is missing from the user profile');
        });
      }

      var query = {email: userObj.email};
      userModel.findOrCreate({ where: query }, userObj, function (err, user) {
        if (err) {
          return cb(err);
        }
        var date = new Date();
        var query = {
          provider: provider,
          externalId: profile.id,
          authScheme: authScheme,
          profile: profile,
          credentials: credentials,
          created: date,
          modified: date
        };
        query[userIdentityModel.relations.user.keyFrom]= user.id;
        userIdentityModel.create(query, function (err, identity) {
          if(!err && user && autoLogin) {
            return (options.createAccessToken || createAccessToken)(user, function(err, token) {
              cb(err, user, identity, token);
            });
          }
          cb(err, user, identity);
        });
      });
    });
  };
  return UserIdentity;
};
