var _ = require('lodash');
var humanname = require('humanname');

module.exports = {

  afterConstruct: function(self, callback) {
    self.enablePassportStrategies();
    self.enableListUrlsTask();
    return self.ensureGroup(callback);
  },

  construct: function(self, options) {

    self.enablePassportStrategies = function() {
      if (!self.apos.baseUrl) {
        throw new Error('apostrophe-passport: you must configure the top-level "baseUrl" option to apostrophe');
      }
      if (!Array.isArray(self.options.strategies)) {
        throw new Error('apostrophe-passport: you must configure the "strategies" option');
      }
      _.each(self.options.strategies, function(spec) {
        var Strategy;
        if (spec.module) {
          Strategy = self.apos.root.require(spec.module);
        } else {
          Strategy = spec.Strategy;
        }
        if (!Strategy) {
          throw new Error('apostrophe-login-auth: each strategy must have a "module" setting\n' +
            'giving the name of an npm module installed in your project that\n' +
            'is passport-oauth2, passport-oauth or a subclass with a compatible\n' +
            'interface, such as passport-gitlab2, passport-twitter, etc.\n\n' +
            'You may instead pass a strategy constructor as a Strategy property,\n' +
            'but the other way is much more convenient.');
        }
        // Are there strategies requiring no options? Probably not, but maybe...
        spec.options = spec.options || {};
        if (!spec.name) {
          // It's hard to find the strategy name; it's not the same
          // as the npm name. And we need it to build the callback URL
          // sensibly. But we can do it by making a dummy strategy object now
          var dummy = new Strategy(_.assign(
            {
              callbackURL: 'https://dummy/test'
            },
            spec.options
          ), self.findOrCreateUser(spec));
          spec.name = dummy.name;
        }
        spec.options.callbackURL = self.getCallbackUrl(spec);
        self.apos.login.passport.use(new Strategy(spec.options, self.findOrCreateUser(spec)));
        self.addLoginRoute(spec);
        self.addCallbackRoute(spec);
      });
    };

    // Returns the oauth2 callback URL, which must match the route
    // established by `addCallbackRoute`.

    self.getCallbackUrl = function(spec) {
      return self.apos.baseUrl + '/auth/' + spec.name + '/callback';        
    };
    
    self.getLoginUrl = function(spec) {
      return '/auth/' + spec.name + '/login';
    }

    // Adds the login route, which will be `/modules/apostrophe-login-gitlab/login`.
    // Redirect users to this URL to start the process of logging them in via gitlab

    self.addLoginRoute = function(spec) {
      self.apos.app.get(self.getLoginUrl(spec), self.apos.login.passport.authenticate(spec.name, spec.authenticate));
    };

    // Adds the oauth2 callback route, which is invoked 
      
    self.addCallbackRoute = function(spec) {
      self.apos.app.get('/auth/' + spec.name + '/callback',
        // middleware
        self.apos.login.passport.authenticate(
          spec.name,
          {
            failureRedirect: self.getFailureUrl(spec)
          }
        ),
        // actual route
        self.apos.login.afterLogin
      );
    };
    
    self.getFailureUrl = function(spec) {
      return '/';
    };
    
    // Given a strategy spec from the configuration, return
    // an oauth passport callback function to find the user based
    // on the profile, creating them if appropriate.

    self.findOrCreateUser = function(spec) {

      return function(accessToken, refreshToken, profile, callback) {
        var req = self.apos.tasks.getReq();
        var criteria = {};
        var emails = [];
        
        if (spec.accept) {
          if (!spec.accept(profile)) {
            return callback(null, false);
          }
        }        

        if (typeof(spec.match) === 'function') {
          criteria = spec.match(profile);
        } else {
          switch (spec.match || 'username') {
            case 'id':
            criteria = {};
            if (!profile.id) {
              console.error('apostrophe-passport: profile has no id. You probably want to set the "match" option for this strategy to "username" or "email".');
              return callback(null, false);
            }
            criteria[spec.name + 'Id'] = profile.id;
            break;
            case 'username':
            if (!profile.username) {
              console.error('apostrophe-passport: profile has no username. You probably want to set the "match" option for this strategy to "id" or "email".');
              return callback(null, false);
            }
            criteria.username = profile.username;
            break;
            case 'email':
            case 'emails':
            if (Array.isArray(profile.emails) && profile.emails.length) {
              _.each(profile.emails || [], function(email) {
                if (typeof(email) === 'string') {
                  // maybe someone does this as simple strings...
                  emails.push(email);
                  // but google does it as objects with value properties
                } else if (email && email.value) {
                  emails.push(email.value);
                }
              });
            } else if (profile.email) {
              emails.push(profile.email);
            } else {
              console.error('apostrophe-passport: profile has no email or emails property. You probably want to set the "match" option for this strategy to "id" or "username".');
              return callback(null, false);
            }
            if (spec.emailDomain) {
              emails = _.filter(emails, function(email) {
                var endsWith = '@' + spec.emailDomain;
                return email.substr(email.length - endsWith.length) === endsWith;
              });
              if (!emails.length) {
                // User is in the wrong domain
                return callback(null, false);
              }
            }
            criteria.$or = _.map(emails, function(email) {
              return { email: email };
            });
            break;
            default:
            return callback(new Error('apostrophe-passport: ' + spec.match + ' is not a supported value for the match property'));
          }
        }
        criteria.disabled = { $ne: true };
        return self.apos.users.find(req, criteria).toObject(function(err, user) {
          if (err) {
            return callback(err);
          }
          if (user) {
            return callback(null, user);
          }
          if (!self.options.create) {
            return callback(null, false);
          }
          return self.createUser(spec, profile, function(err, user) {
            if (err) {
              return callback(err);
            }
            return callback(null, user);
          });
        });
      };
    };
    
    // Create a new user based on a profile. This occurs only
    // if the "create" option is set and a user arrives who has
    // a valid passport profile but does not exist in the local database.

    self.createUser = function(spec, profile, callback) {
      var user = self.apos.users.newInstance();
      user.username = profile.username;
      user.title = profile.displayName || profile.username || '';
      user[spec.name + 'Id'] = profile.id;
      if (!user.username) {
        user.username = self.apos.utils.slugify(user.title);
      }
      var email = profile.emails && profile.emails[0] && profile.emails[0].value;
      if (!email) {
        email = profile.emails && profile.emails[0];
      }
      if (!email) {
        email = profile.email;
      }
      if (email) {
        user.email = email;
      }
      if (profile.name) {
        user.firstName = profile.name.givenName;
        if (profile.name.middleName) {
          user.firstName += ' ' + profile.name.middleName;
        }
        user.lastName = profile.name.familyName;
      } else {
        parsedName = humanname.parse(profile.displayName);
        user.firstName = parsedName.firstName;
        user.lastName = parsedName.lastName;
      }
      var req = self.apos.tasks.getReq();
      if (self.createGroup) {
        user.groupIds = [ self.createGroup._id ];
      }
      if (spec.import) {
        // Allow for specialized import of more fields
        spec.import(profile, user);
      }
      return self.apos.users.insert(req, user, function(err) {
        return callback(err, user);
      });
    };
    
    self.enableListUrlsTask = function() {
      self.apos.tasks.add(self.__meta.name, 'list-urls',
        'Run this task to list the login URLs for each registered strategy.\n' +
        'This is helpful when writing markup to invite users to log in.',
        function(apos, argv, callback) {
          return self.listUrlsTask(callback);
        }
      );
    };
    
    self.listUrlsTask = function(callback) {
      console.log('These are the login URLs you may wish to link users to:\n');
      _.each(self.options.strategies, function(spec) {
        console.log(self.getLoginUrl(spec));
      });
      console.log('\nThese are the callback URLs you may need to configure on sites:\n');
      _.each(self.options.strategies, function(spec) {
        console.log(self.getCallbackUrl(spec));
      });
      return callback(null);
    };

    // Ensure the existence of an apostrophe-group for newly
    // created users, as configured via the `group` subproperty
    // of the `create` option.
    
    self.ensureGroup = function(callback) {
      if (!(self.options.create && self.options.create.group)) {
        return setImmediate(callback);
      }
      return self.apos.users.ensureGroup(self.options.create.group, function(err, group) {
        self.createGroup = group;
        return callback(err);
      });
    };

  }
};
