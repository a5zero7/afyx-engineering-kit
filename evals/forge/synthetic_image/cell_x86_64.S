/* Public deterministic Afyx Forge synthetic cell for Linux x86-64.
 *
 * This standalone ELF uses no libc or dynamic loader. Its successful path
 * invokes only write(2) and exit_group(2), both present in the frozen T09.E6
 * seccomp allowlist.
 */

.section .rodata
mode_flag:
    .asciz "--mode"
public_mode:
    .asciz "public-synthetic"
stdout_message:
    .ascii "AFYX_FORGE_SYNTHETIC_STDOUT_V1\n"
.set stdout_length, . - stdout_message
stderr_message:
    .ascii "AFYX_FORGE_SYNTHETIC_STDERR_V1\n"
.set stderr_length, . - stderr_message
argument_error:
    .ascii "AFYX_FORGE_SYNTHETIC_ARGUMENT_ERROR_V1\n"
.set argument_error_length, . - argument_error

.section .text
.global _start
.type _start, @function
_start:
    cmpq $3, (%rsp)
    jne .Linvalid

    movq 16(%rsp), %rdi
    leaq mode_flag(%rip), %rsi
    call .Lstreq
    testl %eax, %eax
    jz .Linvalid

    movq 24(%rsp), %rdi
    leaq public_mode(%rip), %rsi
    call .Lstreq
    testl %eax, %eax
    jz .Linvalid

    movl $1, %eax
    movl $1, %edi
    leaq stdout_message(%rip), %rsi
    movl $stdout_length, %edx
    syscall
    cmpq $stdout_length, %rax
    jne .Lio_error

    movl $1, %eax
    movl $2, %edi
    leaq stderr_message(%rip), %rsi
    movl $stderr_length, %edx
    syscall
    cmpq $stderr_length, %rax
    jne .Lio_error

    xorl %edi, %edi
    jmp .Lexit

.Linvalid:
    movl $1, %eax
    movl $2, %edi
    leaq argument_error(%rip), %rsi
    movl $argument_error_length, %edx
    syscall
    movl $64, %edi
    jmp .Lexit

.Lio_error:
    movl $74, %edi

.Lexit:
    movl $231, %eax
    syscall
    ud2

.Lstreq:
    movzbl (%rdi), %eax
    cmpb (%rsi), %al
    jne .Lnot_equal
    testb %al, %al
    je .Lequal
    incq %rdi
    incq %rsi
    jmp .Lstreq
.Lnot_equal:
    xorl %eax, %eax
    ret
.Lequal:
    movl $1, %eax
    ret
.size _start, . - _start

.section .note.GNU-stack,"",@progbits
