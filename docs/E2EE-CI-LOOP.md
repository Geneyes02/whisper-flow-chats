# Whispr E2EE CI loop

This branch is the gated integration branch for Phase B E2EE work.

Security-critical slices are validated through pull-request-triggered GitHub Actions before they are considered complete. A passing dependency or upstream OpenMLS audit does not by itself validate Whispr's integration.

Public security claims remain unchanged until the messaging and server-blindness gates pass.
