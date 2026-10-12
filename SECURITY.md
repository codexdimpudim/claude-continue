# Security and privacy

Do not post passwords, tokens, Keychain data, account files, or conversation contents in public issues. For a sensitive vulnerability, use GitHub’s private vulnerability reporting if it is enabled; otherwise report a redacted issue that requests a private contact without exploit details.

The project patches and locally signs a separate Claude app copy. That changes the copy’s trust identity and signing-dependent behavior; read README.md and ARCHITECTURE.md before installation. The original app must remain intact. Unknown builds fail the compatibility check.

Changes must preserve origin restrictions, manual-draft protection, explicit activation, single-window ownership, and no automatic resend after uncertain delivery. This is a tested preview, not a completed security audit.
