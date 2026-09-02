<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Text-to-GEARS Transformation

### TEXT2GEARS-1

Where the phase host supplies `<definition>` as the exact bytes of the definition file the request names, when a transformation request names a `text` Source (`.md`) and a `gears` Target (`.md`), Captain shall carry out the text-to-GEARS transformation as specified:

> Follow the definition relayed between the `--- DEFINITION ---` and `--- END DEFINITION ---` lines exactly, adding no rules of your own: read the named Source and write the named Target as the definition specifies.
> If the Source cannot be transformed under the definition, do not guess: leave the Target unwritten and report the concrete reason.
> --- DEFINITION ---
> <definition>
> --- END DEFINITION ---

Results:
- `compiled`: Captain wrote the named Target as the relayed definition specifies.
- `rejected`: Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.
