# Contributing to ShearPoint

Thank you for your interest in contributing to ShearPoint! We appreciate your efforts to improve this project. This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Documentation](#documentation)
- [Reporting Issues](#reporting-issues)
- [Questions or Need Help?](#questions-or-need-help)

## Code of Conduct

We are committed to providing a welcoming and inclusive environment for all contributors. Please be respectful, kind, and professional in all interactions. We do not tolerate harassment, discrimination, or any form of abusive behavior.

## Getting Started

1. **Fork the Repository**: Click the "Fork" button on the GitHub repository page to create your own copy.

2. **Clone Your Fork**: 
   ```bash
   git clone https://github.com/YOUR_USERNAME/ShearPoint.git
   cd ShearPoint
   ```

3. **Add Upstream Remote**:
   ```bash
   git remote add upstream https://github.com/chamodya246/ShearPoint.git
   ```

4. **Create a Branch**: Create a new branch for your contribution:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## How to Contribute

### Types of Contributions

We welcome contributions in the following areas:

- **Bug Fixes**: Help us identify and fix bugs
- **New Features**: Suggest and implement new functionality
- **Documentation**: Improve and expand documentation
- **Tests**: Add or improve test coverage
- **Performance**: Optimize code performance
- **Code Quality**: Refactor and improve code structure

## Development Setup

1. **Install Dependencies**: Follow the instructions in the README.md to set up your development environment.

2. **Install Development Tools**: Make sure you have the necessary tools installed for development and testing.

3. **Verify Setup**: Run the test suite to ensure everything is working correctly:
   ```bash
   npm test
   ```
   (or the appropriate test command for this project)

## Commit Guidelines

- **Use Clear Commit Messages**: Write concise and descriptive commit messages that explain what changes you made.

- **Commit Message Format**:
  ```
  [Type]: Brief description of changes
  
  Detailed explanation of why the change is necessary and what problems it solves.
  Reference any related issues (e.g., fixes #123).
  ```

- **Types**: Use one of the following prefixes:
  - `feat`: A new feature
  - `fix`: A bug fix
  - `docs`: Documentation changes
  - `style`: Code style changes (formatting, missing semicolons, etc.)
  - `refactor`: Code refactoring without feature changes
  - `perf`: Performance improvements
  - `test`: Adding or updating tests
  - `chore`: Build process, dependency updates, etc.

- **Examples**:
  ```
  feat: Add user authentication feature
  fix: Resolve issue with data validation
  docs: Update API documentation
  ```

## Pull Request Process

1. **Keep Your Branch Updated**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push to Your Fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create a Pull Request**:
   - Go to the original repository and click "Compare & pull request"
   - Provide a clear title and description of your changes
   - Reference any related issues using `#issue-number`
   - Wait for review and feedback

4. **PR Description Template**:
   ```
   ## Description
   Brief description of the changes.
   
   ## Type of Change
   - [ ] Bug fix
   - [ ] New feature
   - [ ] Documentation update
   - [ ] Performance improvement
   - [ ] Other
   
   ## Related Issues
   Closes #(issue number)
   
   ## Testing
   Describe the testing done.
   
   ## Checklist
   - [ ] Code follows project style guidelines
   - [ ] Tests pass locally
   - [ ] Documentation is updated
   - [ ] No new warnings generated
   ```

5. **Address Review Comments**: Be responsive to feedback and make requested changes.

6. **Merge**: Once approved, your PR will be merged by a maintainer.

## Testing

- **Run Tests**: Execute the test suite before submitting your PR:
  ```bash
  npm test
  ```

- **Write Tests**: Add tests for new features and bug fixes to maintain code coverage.

- **Test Coverage**: Aim to maintain or improve test coverage with your contributions.

## Documentation

- **Update README**: If your changes affect how users interact with the project, update the README.md accordingly.

- **Add Comments**: Include clear comments in your code for complex logic.

- **JSDoc/Comments**: Use appropriate documentation style for your code.

- **Examples**: Provide examples for new features when applicable.

## Reporting Issues

If you find a bug or have a feature request:

1. **Check Existing Issues**: Search existing issues to avoid duplicates.

2. **Create a New Issue**: Use the GitHub issue tracker with:
   - A clear title
   - Detailed description of the problem
   - Steps to reproduce (for bugs)
   - Expected vs. actual behavior
   - Your environment (OS, version, etc.)
   - Any relevant error messages or logs

3. **Use Labels**: Help categorize your issue with appropriate labels.

## Questions or Need Help?

- **Discussions**: Use GitHub Discussions if you have questions.
- **Issues**: Feel free to ask questions in relevant issue threads.
- **Documentation**: Check the README and existing documentation first.

---

## License

By contributing to ShearPoint, you agree that your contributions will be licensed under the same license as the project. Please review the LICENSE file for details.

---

**Thank you for contributing to ShearPoint!** 🎉
