# Hello World Workflow

## Description

A simple workflow that prints "Hello, World!" to demonstrate the basic workflow structure.

## Purpose

This workflow serves as a minimal example of how workflows are structured and executed in the FlowPal system.

## Inputs

This workflow does not require any input parameters.

## Outputs

Prints a hello world message to stdout.

## Required Credentials

None - this workflow does not require any secrets or credentials.

## Usage

This workflow can be executed via the `runWorkflow` tool:

```
runWorkflow({ slug: "hello-world", inputs: {} })
```

Or run directly by a human:

```bash
cd workflows/hello-world
python run.py
```

## Example Output

```
Hello, World!
This is a simple workflow demonstration.
```
