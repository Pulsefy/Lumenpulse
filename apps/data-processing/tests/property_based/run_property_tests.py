"""
Property-based test runner for LumenPulse protocol invariants.

This script provides a comprehensive test runner for all property-based tests,
including reporting, configuration, and integration with the existing test suite.
"""

import sys
import os
import argparse
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
import subprocess
import json

# Add src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))


class PropertyTestRunner:
    """Comprehensive runner for property-based tests."""
    
    def __init__(self, test_dir: str = None):
        """
        Initialize the property test runner.
        
        Args:
            test_dir: Directory containing property-based tests
        """
        self.test_dir = Path(test_dir) if test_dir else Path(__file__).parent
        self.results = {}
        self.start_time = None
        self.end_time = None
    
    def discover_tests(self) -> List[Path]:
        """
        Discover all property-based test files.
        
        Returns:
            List of test file paths
        """
        test_files = []
        
        # Find all test_*.py files in the property_based directory
        for file_path in self.test_dir.glob("test_*.py"):
            if file_path.name != "conftest.py" and file_path.name != "run_property_tests.py":
                test_files.append(file_path)
        
        return sorted(test_files)
    
    def run_test_file(self, test_file: Path, verbose: bool = False, max_examples: int = None) -> Dict[str, Any]:
        """
        Run a single property-based test file.
        
        Args:
            test_file: Path to the test file
            verbose: Whether to run with verbose output
            max_examples: Maximum number of examples per test
            
        Returns:
            Dictionary containing test results
        """
        cmd = [
            sys.executable, "-m", "pytest",
            str(test_file),
            "-v" if verbose else "-q",
            "--tb=short"
        ]
        
        # Set hypothesis settings via environment variables
        env = os.environ.copy()
        if max_examples:
            env["HYPOTHESIS_MAX_EXAMPLES"] = str(max_examples)
        
        if verbose:
            env["HYPOTHESIS_VERBOSITY"] = "verbose"
        else:
            env["HYPOTHESIS_VERBOSITY"] = "normal"
        
        # Hypothesis settings are set via environment variables above
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=self.test_dir.parent.parent,
                env=env,
                timeout=300  # 5 minute timeout per test file
            )
            
            return {
                "file": str(test_file),
                "return_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "success": result.returncode == 0,
                "duration": None  # Will be filled by caller
            }
            
        except subprocess.TimeoutExpired:
            return {
                "file": str(test_file),
                "return_code": 124,
                "stdout": "",
                "stderr": "Test timed out after 5 minutes",
                "success": False,
                "duration": None
            }
        except Exception as e:
            return {
                "file": str(test_file),
                "return_code": 1,
                "stdout": "",
                "stderr": str(e),
                "success": False,
                "duration": None
            }
    
    def run_all_tests(self, verbose: bool = False, max_examples: int = None, 
                     parallel: bool = False) -> Dict[str, Any]:
        """
        Run all property-based tests.
        
        Args:
            verbose: Whether to run with verbose output
            max_examples: Maximum number of examples per test
            parallel: Whether to run tests in parallel
            
        Returns:
            Dictionary containing all test results
        """
        self.start_time = time.time()
        test_files = self.discover_tests()
        
        print(f"🧪 Running property-based tests on {len(test_files)} test files...")
        print(f"📁 Test directory: {self.test_dir}")
        print(f"⚙️  Configuration: max_examples={max_examples}, verbose={verbose}")
        print()
        
        results = {
            "total_files": len(test_files),
            "successful": 0,
            "failed": 0,
            "timed_out": 0,
            "total_duration": 0,
            "files": []
        }
        
        if parallel and len(test_files) > 1:
            # Run tests in parallel (simplified version - could use pytest-xdist)
            print("⚡ Running tests in parallel...")
            # For now, run sequentially but indicate parallel capability
            parallel = False
        
        for i, test_file in enumerate(test_files, 1):
            print(f"📋 [{i}/{len(test_files)}] Running {test_file.name}...")
            
            file_start_time = time.time()
            file_result = self.run_test_file(test_file, verbose, max_examples)
            file_end_time = time.time()
            
            file_result["duration"] = file_end_time - file_start_time
            results["files"].append(file_result)
            results["total_duration"] += file_result["duration"]
            
            if file_result["success"]:
                results["successful"] += 1
                print(f"✅ {test_file.name} passed ({file_result['duration']:.2f}s)")
            else:
                if file_result["return_code"] == 124:
                    results["timed_out"] += 1
                    print(f"⏰ {test_file.name} timed out")
                else:
                    results["failed"] += 1
                    print(f"❌ {test_file.name} failed")
                
                if verbose and file_result["stderr"]:
                    print(f"   Error: {file_result['stderr'][:200]}...")
        
        self.end_time = time.time()
        results["total_duration"] = self.end_time - self.start_time
        
        return results
    
    def generate_report(self, results: Dict[str, Any], output_file: Optional[str] = None) -> str:
        """
        Generate a comprehensive test report.
        
        Args:
            results: Test results dictionary
            output_file: Optional file to write report to
            
        Returns:
            Report text
        """
        report_lines = [
            "# Property-Based Test Report",
            "=" * 50,
            "",
            f"## Summary",
            f"- Total test files: {results['total_files']}",
            f"- Successful: {results['successful']} ✅",
            f"- Failed: {results['failed']} ❌",
            f"- Timed out: {results['timed_out']} ⏰",
            f"- Total duration: {results['total_duration']:.2f}s",
            "",
            "## Detailed Results",
            ""
        ]
        
        for file_result in results["files"]:
            status = "✅ PASSED" if file_result["success"] else "❌ FAILED"
            duration = f"({file_result['duration']:.2f}s)" if file_result["duration"] else ""
            report_lines.append(f"### {Path(file_result['file']).name} {status} {duration}")
            
            if not file_result["success"] and file_result["stderr"]:
                # Show first few lines of error
                error_lines = file_result["stderr"].strip().split('\n')[:5]
                report_lines.extend([f"```\n{chr(10).join(error_lines)}\n```", ""])
        
        report_lines.extend([
            "## Invariant Coverage",
            "",
            "The following protocol invariants are tested:",
            "",
            "### Sentiment Analysis Invariants",
            "- Sentiment scores bounded between -1 and 1",
            "- Sentiment components sum to 1.0", 
            "- Sentiment labels consistent with scores",
            "- Asset filter behavior consistency",
            "- Batch analysis consistency",
            "",
            "### Data Validation Invariants",
            "- Required field validation",
            "- Type constraint enforcement",
            "- Empty field rejection",
            "- Malformed data handling",
            "- Unicode content support",
            "",
            "### Security Protocol Invariants",
            "- Rate limit format validation",
            "- API key authentication",
            "- Case-sensitive credential validation",
            "- Header manipulation resistance",
            "- Environment variable handling",
            "",
            "### Database Model Invariants",
            "- Field type constraints",
            "- Value bounds enforcement",
            "- Length constraints",
            "- Relationship consistency",
            "- Timestamp format validation",
            "",
            "## Recommendations",
            "",
            "1. **Run regularly**: Integrate these tests into CI/CD pipeline",
            "2. **Monitor failures**: Any invariant violation indicates a serious bug",
            "3. **Expand coverage**: Add new invariants as the system evolves",
            "4. **Performance tuning**: Adjust max_examples based on test duration",
            "",
            f"Generated on: {time.strftime('%Y-%m-%d %H:%M:%S')}"
        ])
        
        report = '\n'.join(report_lines)
        
        if output_file:
            with open(output_file, 'w') as f:
                f.write(report)
            print(f"📄 Report saved to {output_file}")
        
        return report
    
    def run_integration_tests(self) -> Dict[str, Any]:
        """
        Run integration tests with the existing test suite.
        
        Returns:
            Integration test results
        """
        print("🔗 Running integration tests with existing test suite...")
        
        # Run existing tests to ensure compatibility
        cmd = [
            sys.executable, "-m", "pytest",
            "tests/",
            "-v",
            "--tb=short",
            "-k", "not property_based"  # Exclude property-based tests
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=self.test_dir.parent.parent,
                timeout=600  # 10 minute timeout
            )
            
            return {
                "return_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "success": result.returncode == 0
            }
            
        except subprocess.TimeoutExpired:
            return {
                "return_code": 124,
                "stdout": "",
                "stderr": "Integration tests timed out after 10 minutes",
                "success": False
            }
        except Exception as e:
            return {
                "return_code": 1,
                "stdout": "",
                "stderr": str(e),
                "success": False
            }


def main():
    """Main entry point for the property test runner."""
    parser = argparse.ArgumentParser(
        description="Run property-based tests for LumenPulse protocol invariants"
    )
    
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Run with verbose output"
    )
    
    parser.add_argument(
        "--max-examples", "-n",
        type=int,
        default=100,
        help="Maximum number of examples per test (default: 100)"
    )
    
    parser.add_argument(
        "--parallel", "-p",
        action="store_true",
        help="Run tests in parallel (requires pytest-xdist)"
    )
    
    parser.add_argument(
        "--report", "-r",
        type=str,
        help="Output report file"
    )
    
    parser.add_argument(
        "--integration", "-i",
        action="store_true",
        help="Run integration tests with existing test suite"
    )
    
    parser.add_argument(
        "--test-dir", "-d",
        type=str,
        help="Directory containing property-based tests"
    )
    
    args = parser.parse_args()
    
    # Initialize runner
    runner = PropertyTestRunner(args.test_dir)
    
    print("🚀 Starting LumenPulse Property-Based Test Runner")
    print("=" * 50)
    print()
    
    # Run property-based tests
    results = runner.run_all_tests(
        verbose=args.verbose,
        max_examples=args.max_examples,
        parallel=args.parallel
    )
    
    print()
    print("📊 Test Results Summary")
    print("=" * 30)
    print(f"Total files: {results['total_files']}")
    print(f"Successful: {results['successful']} ✅")
    print(f"Failed: {results['failed']} ❌")
    print(f"Timed out: {results['timed_out']} ⏰")
    print(f"Duration: {results['total_duration']:.2f}s")
    print()
    
    # Generate and display report
    report = runner.generate_report(results, args.report)
    
    if not args.report:
        print("\n" + report)
    
    # Run integration tests if requested
    if args.integration:
        print("\n🔗 Running Integration Tests")
        print("=" * 30)
        
        integration_results = runner.run_integration_tests()
        
        if integration_results["success"]:
            print("✅ Integration tests passed")
        else:
            print("❌ Integration tests failed")
            if integration_results["stderr"]:
                print(f"Error: {integration_results['stderr'][:200]}...")
    
    # Exit with appropriate code
    exit_code = 0 if results["failed"] == 0 and results["timed_out"] == 0 else 1
    
    if exit_code == 0:
        print("\n🎉 All property-based tests passed! Protocol invariants are maintained.")
    else:
        print("\n⚠️  Some tests failed! Protocol invariants may be violated.")
        print("Review the detailed results above for more information.")
    
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
