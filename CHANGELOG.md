# Changelog

## 2.2.0

If the `firstName` and `lastName` are available from the strategy, use those in preference to attempting to parse `displayName`. Thanks to RyamBaCo for this contribution.

## 2.1.0

* Retain all strategy objects used and export them as `self.strategies` to better accommodate strategies that have custom methods.

## 2.0.1

* Proper support for Apostrophe's `prefix` option
* If `callbackURL` is configured for the strategy, respect that setting, otherwise generate one with prefix support

## 2.0.0

Initial release.
