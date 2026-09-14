# Prepare an entry declaration

- Name: `sag declaracion-jurada prepare`
- Effect: local/browser preparation only
- Authentication: anonymous route
- Status: partially observed, deterministic replay incomplete
- Evidence date: 2026-09-13

## Private input

Traveler identity, email, legal document, trip details, minors' luggage, regulated-products answer, and arrival date.

## Steps

1. Choose the anonymous [Entry route](../pages/entry-route.md).
2. Discover nationality and complete [Start](../pages/start.md).
3. Complete and verify [Identification](../pages/identification.md).
4. Discover dependent portal choices and complete [Travel information](../pages/travel-information.md).
5. Apply the explicit legal answer on [Declaration](../pages/declaration.md).
6. Reach [Final review](../pages/final-review.md).
7. Stop with `I Declare` visible and untouched.

## Output

Return only readiness and the identified irreversible boundary. Never return declaration contents.

## Verification

Preparation is complete only when every private value was read back and the final-review evidence is present while no submission reference or receipt exists.

## Stop and recovery

Stop on any global stop condition or unrecognized transition. Correct explicit input only by navigating back from a recognized page. Never continue from an ambiguous checkpoint.
