# License texts omitted by published crate archives

`policy.json` binds supplemental texts to exact package names, versions and
Cargo.lock archive SHA-256 values. Where the published archive includes
`.cargo_vcs_info.json`, its commit and repository subdirectory must also match.
Every copied source text has a fixed upstream URL, byte length and SHA-256.
`collected-*.json` retains the source investigation receipts used to assemble
the policy. Full source archives are linked individually by the generated
distribution inventory.

The supplemental files do not replace or alter license text present in a crate.
They supply upstream repository-root notices omitted by some monorepo packages.
Original manifest license expressions remain unchanged. Where the exact source
expressly offers Apache-2.0 as an OR alternative, the policy may explicitly
select it and retain the complete official Apache text plus the upstream
declaration. This choice does not rewrite AND expressions or other crates'
terms.

The current objc2 repository declaration assigns MIT alone to block2, objc2 and
objc2-encode. It replaces an earlier full MIT notice with links to the standard
license. For these packages the collection retains both the current declaration
at its published VCS commit and the complete original upstream MIT notice with
Steven Sheldon's copyright from commit
`757cd841d0293341dbefd9b99d7548dec244ffde`. The record identifies this as a
historical upstream notice; it does not pretend that file exists at the current
crate commit or invent an additional copyright holder. Other objc2 family
packages explicitly offer Apache-2.0 as an alternative.

Old winapi GNU import-library crates lack published VCS metadata. Their receipts
state the evidence used to associate root upstream notices, rather than claiming
an exact release commit was established. These GNU packages are conservatively
included from the all-target lock; that inclusion does not mean their libraries
are embedded in a Windows MSVC build.

Keep source and canonical-license URLs distinct. Do not normalize upstream file
bytes or replace attribution with a generic license template. A dependency
update requires new checksum/source evidence and updated supplemental receipts.
