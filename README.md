<p align="center">
  <img src="https://i.postimg.cc/T1Wk3khh/logo.png" width="112" alt="o7 Logo" />
</p>

<h1 align="center">@o7/vite-plugin-gql</h1>

<p align="center">Lightest-weight type-safe GraphQL queries</p>
<br />

## Usage

<!-- prettier-ignore -->
```ts
// vite.config.js
import { defineConfig } from 'vite';
import gqlPlugin from '@o7/vite-plugin-gql';

export default defineConfig({
  plugins: [
    gqlPlugin({
      url: 'https://example.com/graphql', // Your endpoint
      headers: {
        'Public-Token': 'abc123',
      },
      outFile: 'src/gql.d.ts',
    }),
  ],
});

// src/index.ts
import gql from '$gql';
const data = await gql(/* GraphQL */ `
  query {
    object {
      id
      name
    }
  }
`);
// ^ Automatically inferred as { object: { id: string, name: string } }
```

## Changelog

### 0.0.3

- removed default overload to fix typescript issues

### 0.0.2

- Fix input object handling
- Handle nullable types properly

### 0.0.1

- Initial release
