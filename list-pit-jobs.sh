#!/usr/bin/env bash

# Usage: bash script.sh <from job-number> <to job-number>

from_job_number=$1
to_job_number=$2
while [ ${from_job_number} -lt $to_job_number ]; do
    pit show "job:${from_job_number}"
    sleep 0.1
    ((from_job_number++))
done
