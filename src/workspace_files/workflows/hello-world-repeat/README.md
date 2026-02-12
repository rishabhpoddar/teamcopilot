# Hello World Repeat Workflow

This workflow prints a "Hello, World!" message a specified number of times.

## What It Does

Prints the message "Hello, World!" repeatedly based on the user-provided count parameter.

## Input Parameters

- `--count` (optional, default: 3): Number of times to print the message
  - Must be between 1 and 100
  - If not provided, defaults to 3

## Output Format

The workflow prints numbered output:
```
[1/5] Hello, World!
[2/5] Hello, World!
[3/5] Hello, World!
[4/5] Hello, World!
[5/5] Hello, World!

Completed! Printed the message 5 time(s).
```

## Example Usage

### Using the runWorkflow tool (for agents):
```
runWorkflow({
  slug: "hello-world-repeat",
  inputs: {
    count: 5
  }
})
```

### Direct execution (for humans):
```bash
cd workflows/hello-world-repeat
python run.py --count 5
```

## Error Handling

- If count is less than 1, the workflow exits with an error
- If count is greater than 100, the workflow exits with an error

## Notes

- No dependencies required (uses only Python standard library)
- Quick execution even for maximum count (100)
- Simple demonstration of parameterized workflows
