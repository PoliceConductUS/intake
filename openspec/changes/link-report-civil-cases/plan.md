## Plan

1. Add a failing ReviewLink contract test and browser test for case navigation.
2. Add the review_links case foreign key migration and regenerate envelopes.
3. Join case links in the report loader; render them as internal anchors.
4. Update the existing manual record through the CLI; generate and apply the mutation.
5. Verify the stored foreign key, current case title/path, same-tab browser navigation, and full validation.
