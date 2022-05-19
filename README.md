<h1 align="center">
  <img alt="OpenHPS" src="https://openhps.org/images/logo_text-512.png" width="40%" /><br />
  @openhps/matlab
</h1>
<p align="center">
    <a href="https://github.com/OpenHPS/openhps-matlab/actions/workflows/main.yml" target="_blank">
        <img alt="Build Status" src="https://github.com/OpenHPS/openhps-matlab/actions/workflows/main.yml/badge.svg">
    </a>
    <a href="https://codecov.io/gh/OpenHPS/openhps-matlab">
        <img src="https://codecov.io/gh/OpenHPS/openhps-matlab/branch/master/graph/badge.svg"/>
    </a>
    <a href="https://codeclimate.com/github/OpenHPS/openhps-matlab/" target="_blank">
        <img alt="Maintainability" src="https://img.shields.io/codeclimate/maintainability/OpenHPS/openhps-matlab">
    </a>
    <a href="https://badge.fury.io/js/@openhps%matlab">
        <img src="https://badge.fury.io/js/@openhps%2Fmatlab.svg" alt="npm version" height="18">
    </a>
</p>

<h3 align="center">
    <a href="https://github.com/OpenHPS/openhps-core">@openhps/core</a> &mdash; <a href="https://openhps.org/docs/matlab">API</a>
</h3>

<br />

This module provides an interface to [MATLAB](mathworks.com/products/matlab.html) that allows you to use existing positioning algorithms created in MATLAB within OpenHPS.

## Getting Started
If you have [npm installed](https://www.npmjs.com/get-npm), start using @openhps/matlab with the following command.
```bash
npm install @openhps/matlab --save
```

## Installation
1. Install MATLAB 2019a or higher

## Usage
This module will serialize data frames and execute a process function.

### Executing File
```typescript
import { ModelBuilder } from '@openhps/core';
import { MatlabProcessingNode } from '@openhps/matlab';

ModelBuilder.create()
    .from(/* ... */)
    .via(new MatlabProcessingNode("test.m"))
    .to(/* ... */)
    .build();
```

### Executing Content
```typescript
import { ModelBuilder } from '@openhps/core';
import { MatlabProcessingNode } from '@openhps/matlab';

ModelBuilder.create()
    .from(/* ... */)
    .via(new MatlabProcessingNode(`
    
    `))
    .to(/* ... */)
    .build();
```

## Contributors
The framework is open source and is mainly developed by PhD Student Maxim Van de Wynckel as part of his research towards *Hybrid Positioning and Implicit Human-Computer Interaction* under the supervision of Prof. Dr. Beat Signer.

## Contributing
Use of OpenHPS, contributions and feedback is highly appreciated. Please read our [contributing guidelines](CONTRIBUTING.md) for more information.

## License
Copyright (C) 2019-2022 Maxim Van de Wynckel & Vrije Universiteit Brussel

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.