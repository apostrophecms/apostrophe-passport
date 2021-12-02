## Purpose

`apostrophe-passport` works together with `passport-google-oauth20`, `passport-gitlab2` and similar [passport](https://npmjs.org/package/passport) strategy modules to let users log in to Apostrophe CMS sites via Google, Gitlab and other authentication providers. This feature is often called federation or single sign-on.

## Installation

You need this module, plus the [passport](https://npmjs.org/package/passport) strategy module(s) of your choice:

```
npm install --save apostrophe-passport
# Just an example, lots of passport modules will work
npm install --save passport-gitlab2
```

Most modules that have "passport" in the name and let you log in via a third-party website will work.

## Configuration

```javascript
  // in app.js
  
  // YOU MUST CONFIGURE baseUrl. For local dev testing
  // you can set it to http://localhost:3000, for production
  // it must be real
  
  baseUrl: 'http://myproductionurl.com',
  
  modules: {
    'apostrophe-passport': {
      strategies: [
        {
          // gitlab login
          // You must npm install --save this module in your project first
          module: 'passport-gitlab2',
          options: {
            // Options for passport-gitlab2, see the documentation of that module,
            // you do not have to set callbackURL
            clientID: 'xxx',
            clientSecret: 'yyy'
          }
        }
      ]
    }
  }
```

## Where do I `require` the passport strategy?

You don't. Apostrophe does it for you. You pass its configuration in the `options` key, and sometimes also the `authenticate` key if it has options that must be passed to its `authenticate` middleware, as with Google (you'll see this in its documentation).

## How do users log in?

Type this command to print the URLs for login, and for the openauth callback URL:

```
node app apostrophe-passport:list-urls
```

You'll see something like:

```
These are the login URLs you may wish to link users to:

/auth/gitlab/login

These are the callback URLs you may need to configure on sites:

http://localhost:3000/auth/gitlab/callback
```

So in this case, you'll want to add a login button to the `layout.html` of your own site that simply links to:

`/auth/gitlab/login`

To generate these links automatically, use the `apos.passport.loginLinks` helper (assuming that you have [set an `alias` of `passport` for this module](https://v2.docs.apostrophecms.org/reference/core-server.html#special-property-names-in-module-configuration-objects)):

```markup
  {% for link in apos.passport.loginLinks() %}
    <h5 class="demo-login-button"><a href="{{ link.href }}"><span>&#xf090;</span> Log in with {{ link.label }}</a></h5>
  {% endfor %}
```

When a user reaches this URL they are redirected to begin the authorization process with Gitlab, or the service of your choice.

Another advantage of using `apos.passport.loginLinks()` is that links generated this way redirect the user back to the same page or piece after login.


## What about logging in on a different hostname with workflow?

When localizing your site with the `apostrophe-workflow` module you may have more than one hostname to accommodate separate locales, but only one hostname is configured as the callback URL for the identity provider. However, if you use `apos.passport.loginLinks()`, you will receive login links that automatically return the user to the hostname they were logging in from.

## Where do I get my `clientID`, `clientSecret`, etc.?

You get these from the website users will log in on, usually by adding an "app" to your profile or developer console. For Google you will need to [create an application in the Google API console and authorize it to use the Google+ API service to access profile information](https://developers.google.com/+/web/api/rest/oauth) (no, this does not mean users have to do anything with Google Plus). See the documentation of the passport strategy module you're using.

You will need to specify a `callbackURL` when registering your "app." You can print that information via the same command line task we saw above:

```
node app apostrophe-passport:list-urls`
```

> You can use a URL like `http://localhost:3000` for testing but in production you must use your production URL. You cannot use an IP address for your callback URL, at least not with Google.

## Google login, and creating users on the fly

By default, users are not created if they don't already exist on the site. If the user on the federated site (gitlab, in this example) is valid but the same username doesn't exist on the Apostrophe site, no login takes place. It's possible to change this.

Google login is a popular case where creating users on the fly can make sense as long as they are part of your email domain. Here's a working configuration for Google login. Note that you must first `npm install` the `passport-google-oauth20` module for your project.

```javascript
'apostrophe-passport': {
  strategies: [
    {
      // google login via openauth
      // You must npm install --save this module in your project first
      module: 'passport-google-oauth20',
      // Default is to match usernames, google has none, so match on emails
      match: 'email',
      // IMPORTANT: accept only users with an email address at our company
      emailDomain: 'mycompany.com',
      options: {
        // options for passport-google-oauth20, see the documentation of
        // that module, you do not have to set callbackURL
        clientID: 'xxx', 
        clientSecret: 'yyy'
      },
      // Options that must be passed to the authenticate middleware
      authenticate: {
        // minimum scopes for matching logins based on email addresses.
        // profile is absolutely required, you almost certainly want email too
        scope: [ 'profile', 'email' ]
      }
    }
  ],
  // Presence of "create" key means we'll create users on the fly
  create: {
    // Presence of "group" means we'll add them to a group...
    group: {
      // Called "google"...
      title: 'google',
      // With these Apostrophe permissions (admin can do ANYTHING, so be careful)
      permissions: [ 'admin' ]
    }
  }
}
```

"What is this `authenticate` key about?" For whatever reason, the `passport-google-oauth20` module requires that some options be passed to passport's `authenticate` middleware, rather than when configuring the strategy. `scope` is one of these and it is required by Google.

"Do I have to pre-create the group users will be added to?" No, it will be created for you. Also, if you supply a `permissions` property, it will always be refreshed to those permissions at restart. You might consider leaving that property off and manually setting the permissions via the groups editor.

## Wait, how do permissions in Apostrophe work again?

A common question at this point. See [managing permissions in Apostrophe](http://apostrophecms.org/docs/tutorials/intermediate/permissions.html).

## Beefing up the "create" option: copying extra properties

The "create" option shown above will create a user with minimal information: first name, last name, full name, username, and email address (where available).

If you wish to import other fields from the profile object provided by the passport strategy, add an `import` function to your configuration for that strategy. The `import` function receives `(profile, user)` and may copy properties from `profile` to `user` as it sees fit.

## Multiple strategies

You may enable more than one strategy at the same time. Just configure them consecutively to the `strategies` array. This means you can have login via Twitter, Google, etc. on the same site.

## How should I map users on their site to users on my site?

It's really up to you. Usernames and emails are *almost* permanent, but people do change them and that can be problematic, especially if they are reused by someone else. (Protip: don't let people reuse email addresses or usernames within your organization. Just retire them.)

On the other hand, IDs are a pain to work with if you are creating users in advance and not using the `create` feature of the module.

You can set the `match` option for any strategy to one of the following choices:

### `id`

Matches on the id of their profile as returned by the strategy module. This is most unique, however if you don't set `create`, then you'll need to find out the ids of users in advance and populate them in your database. You could do that by adding a string field to your `addFields` configuration for `apostrophe-users`.

To accommodate multiple strategies, If the strategy name is `google`, then the id needs to be in the `googleId` field of the suer. If the strategy name is `gitlab`, the id needs to be in `gitlabId`, and so on. If you are using the `create` feature, these properties are automatically populated for you.

**The strategy name and the npm module name are not quite the same thing.** Look at the output of `node app apostrophe-passport:list-urls`. The word that follows `/auth` is the strategy name.

### `email`

This will match on any email the authentication provider indicates they own, whether it is an array in the `.emails` property of their profile containing objects with `.value` properties (as with Google), an array of strings in `.emails`, or just an `email` string property. *To minimize confusion you can also set `match` to `emails` which has the same effect. Either way it will check all three cases.*

### `username`

The default. Users are matched based on having the same username.

### A function of your choice

If you provide a function, it will receive the user's profile from the passport strategy, and must return a MongoDB criteria object matching the appropriate user. Do not worry about checking the `disabled` or `type` properties, Apostrophe will handle that.

## Locking down your site by email address domain name

You may wish to accept only users from one email domain, which is very handy if your company's email is hosted by Google (aka "G Suite"). For that, also set the `emailDomain` option to the domain name you wish to allow. All others are rejected. This is very important if you are using the `create` option.

## Rejecting users for your own reasons

You can set your own policy for rejecting users by passing an `accept` function for any strategy. This function takes the `profile` object provided by the passport strategy and must return `true` otherwise the user is not permitted to log in.

## Disabling ordinary logins

"This is great, but I want to get rid of the regular `/login` page." You can:

```javascript
// in app.js
modules: {
  'apostrophe-passport': {
    // As above; this is not where we disable local login...
  },
  'apostrophe-login': {
    // We disable it here, by configuring the built-in apostrophe-login` module
    localLogin: false
  }
}
```

> The login page is powered by Passport's `local` strategy, which is added to Apostrophe by the standard `apostrophe-login` module. That's why we disable it there and not in `apostrophe-passport`'s options.

## Overriding the error page

If login fails, for instance because you are matching on `email` but the `username` duplicates another account, or because a user is valid in Google but `emailDomain` does not match, the `error.html` template of the `apostrophe-passport` module is rendered. By default, it works, but it's pretty ugly! You'll want to customize it to your project's needs.

Like other templates in Apostrophe, you can override this template by copying it to `lib/modules/apostrophe-passport/views/error.html` *in your project* (**do not modify the npm module itself**). You can then extend your own layout template and so on, just as you have most likely already done for the 404 Not Found page or the `login.html` page.

## Frequently Asked Questions

"What about redirecting `/login` to one of these fancy new strategies?"

You can do that. Once the login page is gone, it's possible for you to decide what happens at that URL. Use the [apostrophe-redirects](https://npmjs.org/package/apostrophe-redirects) module to set it up through a nice UI, or add an Express route and a redirect in your own code.

"I tried this with [passport strategy module X] and it didn't work."

Feel free to open an issue but be sure to provide full specifics and a test project. Note that some strategies may not follow the standard practices this module is built upon. Those written by Jared Hanson, the author of Passport, or following his best practices should work well. You might want to test directly with the sample code provided with that strategy module first, to rule out problems with the module or with your configuration of it.

