// Firebase web config.
//
// These values are PUBLIC by design — Firebase web apps ship them in the
// browser. Security comes from the Firestore rules (see firestore.rules),
// which allow anyone to READ the bowl data but only the authenticated
// device account to WRITE it.
//
// Fill these in from: Firebase console -> gear icon -> Project settings
// -> Your apps -> web app config.

export const firebaseConfig = {
  apiKey: "AIzaSyAgRivHYskiti93B7qd483fcrT4w6eRXDA",
  projectId: "pet-bowl-scale",
};
