# @org-os/host

The host-provider seam for org-os. Defines one `HostDriver` interface; every
script/command that touches `git`, `gh`, or `raw.githubusercontent` calls it
instead. Drivers: `github` (this package) and `radicle` (`@org-os/rad`).
`resolveDriver(config)` picks the driver from `federation.yaml → platforms.canonical`.

Reads may degrade (public seed / cache); writes go through a single injected
executor and fail loudly rather than silently — see the spec.
