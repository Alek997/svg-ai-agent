# Use Braintrust for in app eval review

SVG Studio lists eval runs uploaded to its configured Braintrust project and uses Braintrust as the source of truth for one shared human review per completed SVG output. Each explicit save publishes the review immediately, so reviewers can reopen the same rating from any device without access to the machine that ran the eval. The app loads previously synced ratings and leaves ratings saved only on disk available for manual migration.
