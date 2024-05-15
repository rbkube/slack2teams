module.exports = {
  extends: ['next', 'next/core-web-vitals'],
  parser: '@babel/eslint-parser',
  rules: {
    'comma-style': ['error', 'last'],
    'comma-dangle': ['error', 'always-multiline'],
    'no-trailing-spaces': 'error',
    'keyword-spacing': [
      'error',
      {
        before: true,
        after: true,
      },
    ],
    'object-curly-spacing': ['error', 'always'],
    semi: ['error', 'always'],
  },
};
