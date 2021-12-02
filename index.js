const _ = require('lodash');
const humanname = require('humanname');
const util = require('util');

module.exports = {

  afterConstruct: function(self, callback) {
    self.enablePassportStrategies();
    self.enableListUrlsTask();
    return self.ensureGroup(callback);
  },

  construct: function(self, options) {

    self.enablePassportStrategies = function() {
      self.strategies = {};
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
        spec.label = spec.label || spec.name;
        spec.options.callbackURL = self.getCallbackUrl(spec, true);
        self.strategies[spec.name] = new Strategy(spec.options, self.findOrCreateUser(spec));
        self.apos.login.passport.use(self.strategies[spec.name]);
        self.addLoginRoute(spec);
        self.addCallbackRoute(spec);
        self.addFailureRoute(spec);
      });

      self.on('apostrophe-login:after', 'redirectToNewLocale', async req => {
        const workflow = self.apos.modules['apostrophe-workflow'];
        if (!workflow) {
          return;
        }
        const cacheSet = util.promisify(workflow.crossDomainSessionCache.set);
        const deserializeUser = util.promisify(self.apos.login.deserializeUser);
        if (!req.session.passportWorkflow) {
          return;
        }
        const {
          oldLocale,
          newLocale,
          oldSlug
        } = req.session.passportWorkflow;
        delete req.session.passportWorkflow;
        const crossDomainSessionToken = self.apos.utils.generateId();
        await cacheSet(crossDomainSessionToken, JSON.stringify(req.session), 60 * 60);
        req.user = await deserializeUser(req.user._id);
        let doc = await self.apos.docs.find(req, {
          slug: oldSlug
        }).workflowLocale(oldLocale).joins(false).areas(false).toObject();
        if (doc && doc.workflowGuid) {
          doc = await self.apos.docs.find(req, {
            workflowGuid: doc.workflowGuid
          }).workflowLocale(newLocale).toObject();
        }
        if (doc) {
          slug = doc.slug;
        } else {
          // Fall back to home page
          slug = '/';
          if (workflow.options.prefixes && workflow.options.prefixes[newLocale]) {
            slug = workflow.options.prefixes[newLocale] + '/';
          }
        }
        let url = self.apos.urls.build(workflow.action + '/link-to-locale', {
          slug,
          newLocale,
          workflowCrossDomainSessionToken: crossDomainSessionToken,
          cb: Math.random().toString().replace('.', '')
        });
        if (workflow.hostnames && workflow.hostnames[newLocale]) {
          const oldLocale = req.locale;
          req.locale = newLocale;
          url = self.apos.pages.getBaseUrl(req) + url;
          req.locale = oldLocale;
        }
        if (url.match(/^https?:/)) {
          req.redirect = url;
        } else {
          // Because any sitewide prefix will already be added
          // by res.redirect() as patched by apostrophe and invoked
          // by the afterLogin handler
          req.redirect = url.replace(self.apos.prefix, '');
        }
      });
    };

    // Returns the oauth2 callback URL, which must match the route
    // established by `addCallbackRoute`. If `absolute` is true
    // then `baseUrl` and `apos.prefix` are prepended, otherwise
    // not (because `app.get` automatically prepends a prefix).
    // If the callback URL was preconfigured via spec.options.callbackURL
    // it is returned as-is when `absolute` is true, otherwise
    // the pathname is returned with any `apos.prefix` removed
    // to avoid adding it twice in `app.get` calls.

    self.getCallbackUrl = function(spec, absolute) {
      if (spec.options && spec.options.callbackURL) {
        var url = spec.options.callbackURL;
        if (absolute) {
          return url;
        }
        var parsed = require('url').parse(url);
        url = parsed.pathname;
        if (self.apos.prefix) {
          // Remove the prefix if present, so that app.get doesn't
          // add it redundantly
          return url.replace(new RegExp('^' + self.apos.utils.regExpQuote(self.apos.prefix)), '');
        }
        return parsed.pathname;
      }
      return (absolute ? (self.apos.baseUrl + self.apos.prefix) : '') + '/auth/' + spec.name + '/callback';        
    };
    
    // Returns the URL you should link users to in order for them
    // to log in. If `absolute` is true then `baseUrl` and `apos.prefix`
    // are prepended, otherwise not (because `app.get` automatically prepends a prefix).
    self.getLoginUrl = function(spec, absolute) {
      return (absolute ? (self.apos.baseUrl + self.apos.prefix) : '') + '/auth/' + spec.name + '/login';
    }

    // Adds the login route, which will be `/auth/strategyname/login`, where the strategy name
    // depends on the passport module being used.
    //
    // Redirect users to this URL to start the process of logging them in via each strategy
    self.addLoginRoute = function(spec) {
      self.apos.app.get(self.getLoginUrl(spec), (req, res, next) => {
        if (req.query.newLocale) {
          req.session.passportWorkflow = {
            oldLocale: req.query.oldLocale,
            newLocale: req.query.newLocale,
            oldSlug: req.query.oldSlug
          };
          return res.redirect(self.apos.urls.build(req.url, { newLocale: null, oldLocale: null, oldSlug: null }));
        }
        return next();
      }, self.apos.login.passport.authenticate(spec.name, spec.authenticate));
    };

    // Adds the callback route associated with a strategy. oauth-based strategies and
    // certain others redirect here to complete the login handshake
    self.addCallbackRoute = function(spec) {
      self.apos.app.get(self.getCallbackUrl(spec, false),
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
    
    self.addFailureRoute = function(spec) {
      self.apos.app.get(self.getFailureUrl(spec), function(req, res) {
        // Gets i18n'd in the template, also bc with what templates that tried to work
        // before certain fixes would expect (this is why we still pass a string and not
        // a flag, and why we call it `message`)
        return self.sendPage(req, 'error', { spec: spec, message: 'Your credentials were not accepted, your account is not affiliated with this site, or an existing account has the same username or email address.' });
      });
    }
    
    self.getFailureUrl = function(spec) {
      return '/auth/' + spec.name + '/error';
    };
    
    // Given a strategy spec from the configuration, return
    // an oauth passport callback function to find the user based
    // on the profile, creating them if appropriate.

    self.findOrCreateUser = function(spec) {

      return function(accessToken, refreshToken, profile, callback) {
        var req = self.apos.tasks.getReq();
        var criteria = {};
        var emails;
        
        if (spec.accept) {
          if (!spec.accept(profile)) {
            return callback(null, false);
          }
        }     
        
        emails = self.getRelevantEmailsFromProfile(spec, profile);   
        if (spec.emailDomain && (!emails.length)) {
          // Email domain filter is in effect and user has no emails or
          // only emails in the wrong domain
          return callback(null, false);
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
            if (!emails.length) {
              // User has no email
              return callback(null, false);
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
              // Typically a duplicate key, not surprising with username and
              // email address duplication possibilities when we're matching
              // on the other field, treat it as a login error
              return callback(null, false);
            }
            return callback(null, user);
          });
        });
      };
    };
    
    // Returns an array of email addresses found in the user's
    // profile, via profile.emails[n].value, profile.emails[n] (a string),
    // or profile.email. Passport strategies usually normalize
    // to the first of the three.
    
    self.getRelevantEmailsFromProfile = function(spec, profile) {
      var emails = [];
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
      }
      if (spec.emailDomain) {
        emails = _.filter(emails, function(email) {
          var endsWith = '@' + spec.emailDomain;
          return email.substr(email.length - endsWith.length) === endsWith;
        });
      }
      return emails;
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
      var emails = self.getRelevantEmailsFromProfile(spec, profile);
      if (emails.length) {
        user.email = emails[0];
      }
      if (profile.name) {
        user.firstName = profile.name.givenName;
        if (profile.name.middleName) {
          user.firstName += ' ' + profile.name.middleName;
        }
        user.lastName = profile.name.familyName;
      } else if (profile.firstName || profile.lastName) {
        user.firstName = profile.firstName;
        user.lastName = profile.lastName;
      } else if (profile.displayName) {
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
        console.log(`${spec.label}: ${self.getLoginUrl(spec, true)}`);
      });
      console.log('\nThese are the callback URLs you may need to configure on sites:\n');
      _.each(self.options.strategies, function(spec) {
        console.log(`${spec.label}: ${self.getCallbackUrl(spec, true)}`);
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

    self.addHelpers({
      loginLinks() {
        const workflow = self.apos.modules['apostrophe-workflow'];
        const contextReq = self.apos.templates.contextReq;
        return self.options.strategies.map(spec => {
          let href = self.getLoginUrl(spec, true);
          if (workflow && (Object.keys(workflow.locales).length > 1)) {
            href = self.apos.urls.build(href, {
              oldLocale: contextReq.locale,
              newLocale: workflow.liveify(contextReq.locale),
              oldSlug: workflow.getContext(contextReq) && workflow.getContext(contextReq).slug
            });
          }
          return {
            name: spec.name,
            label: spec.label,
            href
          };
        });
      }
    })

  }
};
