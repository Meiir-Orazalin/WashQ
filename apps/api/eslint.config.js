import baseConfig from '@washqueue/eslint-config/base';

export default [
  ...baseConfig,
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
