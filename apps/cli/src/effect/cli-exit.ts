export class CliExit extends Error {
	readonly code: number;
	readonly printed: boolean;

	constructor(code: number, printed: boolean = false, message: string = 'CLI exit') {
		super(message);
		this.name = 'CliExit';
		this.code = code;
		this.printed = printed;
	}
}

export const exitWith = (code: number, printed: boolean = false): never => {
	throw new CliExit(code, printed);
};
