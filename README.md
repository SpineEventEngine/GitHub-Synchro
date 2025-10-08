This application one-way synchronizes the labels between the GitHub repos.

It takes the `config.yml` file as an input. The file format is explained below:


```yaml
from-repo: YourOrganization/your-repo
to-repos:
  - TargetOrg/firstRepo
  - AnotherTargetOrg/secondRepo
  - AndSoOnOrganization/oneMoreRepo
```

* `from-repo` is the `<owner>/<repo-name>` of the source repository. 
* `to-repos` is the list of the target repos. They have the same `<owner>/<repo-name>` format.

The labels of `from-repo` will be copied to `to-repos`, overwriting the existing labels by the label name.

## Internals

The code is executed on behalf of the GitHub application, which at launch should be given the access 
to the repositories specified in `config.yml`.

By default, it is a `Synchrophasotron` OAuth application owned by Spine Event Engine GitHub organization

The client ID of this app is located in `.env` file.

## Building and packaging

1. (One-time) install `pkg`:



2. Build the code with
```bash
  npm run build
```

3. Package the code into a binary with

```bash
  pkg ./dist/index.js --targets node18-macos-x64,node18-macos-arm64 --output github-synchro
```

where `node18-macos-arm64` and node18-macos-x64 are the target architectures.


⚠️ Even though https://github.com/vercel/pkg is deprecated, it is easy-to-use, so we are using it.

4. The resulting distribution must include `.env` file, which denotes the ID of the GitHub App.