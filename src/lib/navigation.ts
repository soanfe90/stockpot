/**
 * Going back from a screen that might be the bottom of the stack.
 *
 * Most screens here are pushed, so `router.back()` is right. A few are
 * *replaced* into by the sign-in gate in the root layout -- Settings during
 * signup, most obviously -- and a few can be opened from a deep link, which
 * starts the app on them with nothing underneath. Calling back() there is a
 * no-op that logs "The action 'GO_BACK' was not handled by any navigator", and
 * leaves the person stuck on a screen whose Cancel button does nothing.
 *
 * So: go back if there is anywhere to go, and otherwise go somewhere sensible.
 */
import { type useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

export function backOr(router: Router, fallback: Parameters<Router['replace']>[0]): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
