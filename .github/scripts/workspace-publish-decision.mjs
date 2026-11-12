// The publish decision of workspace-publish.sh (PLAT-461), kept pure so the tests can drive every rule directly.
//
//   decide({treeIdentical, gitHeadKnown, gitHeadReachable, gitHead, tagCommit, pkg, latest, targetOnNpm}) -> {action: 'skip' | 'publish' | 'fail', target?, reason}
//
// - treeIdentical: the content of the package folder at the tag equals its content at the commit npm says the latest
//   published version was built from (gitHead).
// - gitHeadKnown: npm has a gitHead for the latest version and that commit is in the checkout. Not known means changed.
// - gitHeadReachable: the gitHead is the tag's commit or an ancestor of it (only meaningful when gitHeadKnown); gitHead
//   and tagCommit are the two commits, named in the failure message.
// - pkg: the version in package.json; latest: the "latest" dist-tag on npm (0.0.0 when never published).
// - targetOnNpm: the version nextVersion(pkg, latest) already exists on npm.
// Rules: a version that is not plain major.minor.patch fails; identical content with a known gitHead is the only skip;
// a known gitHead that is not behind the tag (an older release after a newer one) fails; otherwise the target is published: pkg when it is higher than latest, else latest with the patch raised (above the
// latest dist-tag, even when a higher version exists under another tag); an existing target fails.
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const PLAIN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

const parts = (v) => v.split('.').map(Number);

// Numeric, part by part: 2.10.0 is higher than 2.9.0.
export function isHigher(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export function nextVersion(pkg, latest) {
  for (const v of [pkg, latest]) if (!PLAIN.test(v)) throw new Error(`'${v}' is not a plain major.minor.patch version`);
  if (isHigher(pkg, latest)) return pkg;
  const [major, minor, patch] = parts(latest);
  return `${major}.${minor}.${patch + 1}`;
}

export function decide({treeIdentical, gitHeadKnown, gitHeadReachable, gitHead, tagCommit, pkg, latest, targetOnNpm}) {
  let target;
  try {
    target = nextVersion(pkg, latest);
  } catch (e) {
    return {action: 'fail', reason: e.message};
  }
  if (treeIdentical && gitHeadKnown) return {action: 'skip', reason: 'content identical to the latest published build'};
  if (gitHeadKnown && !gitHeadReachable) {
    return {action: 'fail', reason: `npm's latest workspace-sdk@${latest} was built from ${gitHead}, which is neither the tag commit ${tagCommit} nor an ancestor of it; an older release must not replace a newer one`};
  }
  if (targetOnNpm) return {action: 'fail', target, reason: `workspace-sdk@${target} is already on npm; refusing to skip`};
  return {action: 'publish', target, reason: 'changed since the latest published build'};
}

// After a successful publish: npm's record of the new version should carry a gitHead (the skip rule needs it). lookup is
// 'ok' or 'failed'. Returns the GitHub warning line, or null when the marker is there. Never a failure.
export function markerWarning({name, version, lookup, gitHead}) {
  if (lookup === 'ok' && String(gitHead ?? '').trim()) return null;
  const why = lookup === 'ok' ? 'has no gitHead on npm' : 'could not be read back from npm, so its gitHead is unknown';
  return `::warning::${name}@${version} ${why}; a re-run of this job would publish another version`;
}

// Command line, called by workspace-publish.sh:
//   target <pkg> <latest>                                   prints the target version; exit 1 on a bad version
//   decide <yes|no> <yes|no> <pkg> <latest> <yes|no> <yes|no> <gitHead> <tagCommit>
//                                                           treeIdentical gitHeadKnown pkg latest targetOnNpm
//                                                           gitHeadReachable gitHead tagCommit; prints the action, reason
//   marker <name> <version> <ok|failed> <gitHead>           prints the warning line, or nothing; exit 0
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === 'target') console.log(nextVersion(a[0], a[1]));
    else if (cmd === 'decide') {
      const r = decide({treeIdentical: a[0] === 'yes', gitHeadKnown: a[1] === 'yes', pkg: a[2], latest: a[3], targetOnNpm: a[4] === 'yes', gitHeadReachable: a[5] === 'yes', gitHead: a[6], tagCommit: a[7]});
      console.log(r.action);
      console.log(r.reason);
    } else if (cmd === 'marker') {
      const w = markerWarning({name: a[0], version: a[1], lookup: a[2], gitHead: a[3]});
      if (w) console.log(w);
    } else throw new Error(`unknown command '${cmd}'`);
  } catch (e) {
    console.error(`workspace-sdk: ${e.message}`);
    process.exit(1);
  }
}
