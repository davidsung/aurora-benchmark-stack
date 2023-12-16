const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  authorEmail: 'david@davidsung.io',
  authorName: 'David Sung',
  cdkVersion: '2.72.1',
  defaultReleaseBranch: 'main',
  name: 'aurora-benchmark-stack',
  gitignore: [
    '.DS_Store',
    '.vscode',
    'scripts/custom_schema',
    'stack.yaml',
  ],

  // deps: [],                /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  devDeps: [
    'ts-node@^10',
  ], /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});
project.synth();