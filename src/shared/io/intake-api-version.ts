// A dependency-free leaf so the generated envelope modules can import the API
// version without importing import-types.js (which would cycle through the
// generated ARTIFACT_MODULES).
export const INTAKE_API_VERSION = "policeconduct.org/intake/v1alpha1";
