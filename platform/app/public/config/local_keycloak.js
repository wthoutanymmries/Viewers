/** @type {AppTypes.Config} */

// Local Keycloak (OIDC) proof-of-concept configuration.
//
// This is a copy of config/default.js with an `oidc` block added so the viewer
// gates access behind a Keycloak login (Authorization Code Flow + PKCE).
//
// Run it with:
//   cd platform/app
//   APP_CONFIG=config/local_keycloak.js pnpm run dev
//
// Prerequisites (see the auth walkthrough):
//   1. Keycloak running at http://localhost:8080 (docker `start-dev`).
//   2. A realm named `ohif`.
//   3. A public OpenID Connect client `ohif-viewer` with:
//        - Client authentication: OFF (public client, uses PKCE)
//        - Standard flow: ON (Authorization Code Flow)
//        - Valid redirect URIs: http://localhost:3000/callback
//        - Web origins:         http://localhost:3000
//   4. At least one user with a (non-temporary) password.
//
// NOTE (POC scope): the data source below is OHIF's public read-only demo
// server. It does NOT validate the token the viewer sends, so this setup gates
// the *UI* with a real login but does not enforce authorization on the imaging
// data itself. End-to-end enforcement requires a DICOMweb server that validates
// the bearer token (a phase-2 concern).
window.config = {
  name: 'config/local_keycloak.js',
  routerBasename: null,
  extensions: [],
  modes: [],
  customizationService: {},

  // --- Authentication (OpenID Connect / Keycloak) ----------------------------
  oidc: [
    {
      // Keycloak realm base URL: http://<host>:<port>/realms/<realm>
      authority: 'http://localhost:8080/realms/ohif',
      client_id: 'ohif-viewer',
      redirect_uri: '/callback',
      response_type: 'code', // Authorization Code Flow
      useAuthorizationCodeFlow: true, // enables PKCE
      scope: 'openid profile email',
      post_logout_redirect_uri: '/logout-redirect.html',
      automaticSilentRenew: true,
      revokeAccessTokenOnSignout: true,
    },
  ],
  // ----------------------------------------------------------------------------

  showStudyList: true,
  // some windows systems have issues with more than 3 web workers
  maxNumberOfWebWorkers: 3,
  // below flag is for performance reasons, but it might not work for all servers
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 5,
    // Prefetch number is dependent on the http protocol. For http 2 or
    // above, the number of requests can be go a lot higher.
    prefetch: 25,
  },
  showErrorDetails: 'always', // 'always', 'dev', 'production'
  defaultDataSourceName: 'ohif',
  dataSources: [
    {
      // Read-only public demo server. Replace with your own DICOMweb server
      // (one that validates the OIDC token) for real end-to-end authorization.
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'thumbnail',
        thumbnailRequestStrategy: 'fetch',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn(error.status);
    console.warn('test, navigate to https://ohif.org/');
  },
};
